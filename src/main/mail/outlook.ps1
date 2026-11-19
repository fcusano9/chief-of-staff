# Reads mail from classic Outlook over COM for Chief of Staff (see outlook.ts).
# Read-only except -Action open (displays one message) and -Action reply (saves a reply to Drafts, or shows it).
# Never sends, moves, flags or deletes.
#   -Action list -Since <ISO time> -OutFile <path>   writes received (Inbox and subfolders) and sent mail as JSON
#   -Action open -EntryId <id> -StoreId <id> -OutFile <path>   shows the message in Outlook
#   -Action latest -EntryId <id> -StoreId <id> [-Person <address>] [-Later <n>] -OutFile <path>   the email a draft reply answers in that message's conversation, and the emails after it
#   -Action recipients -EntryId <id> -StoreId <id> -OutFile <path>   who Reply and Reply all would go to (nothing is saved)
#   -Action reply -EntryId <id> -StoreId <id> -BodyFile <path> [-ReplyAll] [-Open] -OutFile <path>   saves a reply to Drafts, or with -Open shows it in a window instead; never sends
#   -Action me -OutFile <path>   the mailbox's email addresses
#   -Action calendar -Since <ISO time> -Until <ISO time> -OutFile <path>   entries in the default calendar overlapping that span, repeats included
#   -Action openevent -EntryId <id> -StoreId <id> -Start <ISO time> -OutFile <path>   shows that calendar entry (the occurrence at -Start, for a repeating one)
# The calendar actions only read; they never create, change, delete or answer a meeting.
# The result is always JSON in -OutFile: { ok: true, ... } or { ok: false, error, code }.
param(
  [Parameter(Mandatory = $true)][ValidateSet('list', 'open', 'latest', 'recipients', 'reply', 'me', 'calendar', 'openevent')][string]$Action,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$Since,
  [string]$Until,
  [string]$Start,
  [string]$EntryId,
  [string]$StoreId,
  [string]$BodyFile,
  [switch]$ReplyAll,
  [switch]$Open,
  [string]$Person = '',
  [int]$Later = 10,
  [int]$MaxBody = 30000
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Write-Result($value) {
  [System.IO.File]::WriteAllText($OutFile, (ConvertTo-Json $value -Depth 5 -Compress), $utf8)
}

$PR_SMTP = 'http://schemas.microsoft.com/mapi/proptag/0x5D01001F'
$PR_HEADERS = 'http://schemas.microsoft.com/mapi/proptag/0x007D001F'
$PR_MESSAGE_ID = 'http://schemas.microsoft.com/mapi/proptag/0x1035001F'
$PR_SMTP_ADDRESS = 'http://schemas.microsoft.com/mapi/proptag/0x39FE001F'

function Get-Prop($item, $name) {
  try { return [string]$item.PropertyAccessor.GetProperty($name) } catch { return '' }
}

function Get-SenderEmail($item) {
  $smtp = Get-Prop $item $PR_SMTP
  if ($smtp) { return $smtp }
  try {
    if ($item.SenderEmailType -eq 'EX') {
      $user = $item.Sender.GetExchangeUser()
      if ($user) { return [string]$user.PrimarySmtpAddress }
    }
  } catch {}
  try { return [string]$item.SenderEmailAddress } catch { return '' }
}

function Get-Header($headers, $name) {
  $m = [regex]::Match($headers, "(?im)^$([regex]::Escape($name)):\s*(.+)$")
  if ($m.Success) { return $m.Groups[1].Value.Trim() } else { return '' }
}

# Sent by a machine, not a person: an out-of-office or other automatic reply, or an Auto-Submitted
# header other than "no". The same rule and patterns as isAutomatic in plan.ts (tests/mail.test.ts checks them).
function Test-Automatic($item) {
  if ([string]$item.MessageClass -match '^IPM\.Note\.Rules\.OofTemplate') { return $true }
  if ([string]$item.Subject -match '^\s*(automatic reply|auto(matic)?[- ]reply|out of (the )?office)\b') { return $true }
  $auto = Get-Header (Get-Prop $item $PR_HEADERS) 'Auto-Submitted'
  return [bool]($auto -and $auto -notmatch '^no$')
}

# Whether $address (lower case) sent this email or is among its recipients.
function Test-Includes($item, $address) {
  if (-not $address) { return $false }
  if ((Get-SenderEmail $item).ToLowerInvariant() -eq $address) { return $true }
  foreach ($r in $item.Recipients) {
    $a = Get-Prop $r $PR_SMTP_ADDRESS
    if (-not $a) { try { $a = [string]$r.Address } catch { $a = '' } }
    if ($a.ToLowerInvariant() -eq $address) { return $true }
  }
  return $false
}

# One email as a draft reply needs it: whether the user sent it, who sent it and to whom, and its text.
function Convert-Reply($item, $mine, $sentFolder) {
  $fromEmail = Get-SenderEmail $item
  $body = ''
  try { $body = [string]$item.Body } catch {}
  if ($body.Length -gt $MaxBody) { $body = $body.Substring(0, $MaxBody) }
  $to = ''; $cc = ''
  try { $to = [string]$item.To; $cc = [string]$item.CC } catch {}
  [ordered]@{
    entryId = [string]$item.EntryID
    fromMe  = [bool](([string]$item.Parent.EntryID -eq $sentFolder) -or ($mine -contains $fromEmail.ToLowerInvariant()))
    from    = [string]$item.SenderName
    to      = $to
    cc      = $cc
    subject = [string]$item.Subject
    time    = $item.SentOn.ToUniversalTime().ToString('o')
    body    = $body
  }
}

function Convert-Item($item, $folderPath, $direction) {
  $class = [string]$item.MessageClass
  $isMail = $item.Class -eq 43
  $time = if ($direction -eq 'sent') { $item.SentOn } else { $item.ReceivedTime }
  $headers = if ($direction -eq 'received' -and $isMail) { Get-Prop $item $PR_HEADERS } else { '' }
  $body = ''
  if ($isMail) {
    try { $body = [string]$item.Body } catch { $body = '' }
    if ($body.Length -gt $MaxBody) { $body = $body.Substring(0, $MaxBody) }
  }
  $from = ''; $fromEmail = ''
  try { $from = [string]$item.SenderName } catch {}
  if ($isMail) { $fromEmail = Get-SenderEmail $item }
  $to = ''; $cc = ''
  try { $to = [string]$item.To; $cc = [string]$item.CC } catch {}
  [ordered]@{
    entryId        = [string]$item.EntryID
    storeId        = [string]$item.Parent.StoreID
    messageId      = Get-Prop $item $PR_MESSAGE_ID
    conversationId = [string]$item.ConversationID
    topic          = [string]$item.ConversationTopic
    subject        = [string]$item.Subject
    messageClass   = $class
    isMail         = $isMail
    direction      = $direction
    folder         = $folderPath
    from           = $from
    fromEmail      = $fromEmail
    to             = $to
    cc             = $cc
    time           = $time.ToUniversalTime().ToString('o')
    listUnsubscribe = [bool](Get-Header $headers 'List-Unsubscribe')
    listId         = Get-Header $headers 'List-Id'
    precedence     = Get-Header $headers 'Precedence'
    autoSubmitted  = Get-Header $headers 'Auto-Submitted'
    body           = $body
  }
}

function Get-MyAddresses($ns) {
  $addresses = New-Object System.Collections.ArrayList
  $me = $ns.CurrentUser
  try { $u = $me.AddressEntry.GetExchangeUser(); if ($u) { [void]$addresses.Add([string]$u.PrimarySmtpAddress) } } catch {}
  try { [void]$addresses.Add([string]$me.Address) } catch {}
  foreach ($account in $ns.Accounts) { try { [void]$addresses.Add([string]$account.SmtpAddress) } catch {} }
  return @($addresses)
}

try {
  try {
    $outlook = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
  } catch {
    Write-Result ([ordered]@{ ok = $false; code = 'not_running'; error = "Outlook isn't running. Open Outlook, then try again." })
    exit 0
  }
  $ns = $outlook.GetNamespace('MAPI')

  if ($Action -eq 'me') {
    Write-Result ([ordered]@{ ok = $true; addresses = @(Get-MyAddresses $ns) })
    exit 0
  }

  if ($Action -eq 'open') {
    $item = $ns.GetItemFromID($EntryId, $StoreId)
    $item.Display()
    Write-Result ([ordered]@{ ok = $true })
    exit 0
  }

  if ($Action -eq 'latest') {
    # Picks the email a draft reply answers, by the same rule as replyTarget in plan.ts. Walks the
    # message's conversation (Outlook's own threading, across folders); only emails actually sent
    # count, so drafts and Deleted Items are left out. The reply goes on the newest one that includes
    # -Person (from, to or cc) and isn't automatic (out of office); else the newest that isn't
    # automatic; else the newest. Up to -Later emails after it that aren't automatic (a side
    # discussion without that person) come back as 'after', for the AI to read. Falls back to the
    # message itself when the store doesn't support conversations.
    $item = $ns.GetItemFromID($EntryId, $StoreId)
    $address = $Person.Trim().ToLowerInvariant()
    $skipFolders = @()
    foreach ($n in 3, 16) { try { $skipFolders += [string]$ns.GetDefaultFolder($n).EntryID } catch {} }
    $nodes = New-Object System.Collections.ArrayList
    [void]$nodes.Add($item)
    $conv = $null
    try { $conv = $item.GetConversation() } catch {}
    if ($conv) {
      $stack = New-Object System.Collections.Stack
      foreach ($root in $conv.GetRootItems()) { $stack.Push($root) }
      while ($stack.Count -gt 0) {
        $node = $stack.Pop()
        try { foreach ($child in $conv.GetChildren($node)) { $stack.Push($child) } } catch {}
        [void]$nodes.Add($node)
      }
    }
    $found = New-Object System.Collections.ArrayList
    $seen = @{}
    foreach ($node in $nodes) {
      try {
        if ($node.Class -ne 43 -or -not $node.Sent) { continue }
        if ($skipFolders -contains [string]$node.Parent.EntryID) { continue }
        $id = [string]$node.EntryID
        if ($seen.ContainsKey($id)) { continue }
        $seen[$id] = $true
        [void]$found.Add([pscustomobject]@{ item = $node; sent = $node.SentOn; auto = (Test-Automatic $node); has = (Test-Includes $node $address) })
      } catch {}
    }
    if ($found.Count -eq 0) { [void]$found.Add([pscustomobject]@{ item = $item; sent = $item.SentOn; auto = $false; has = $false }) }
    $sorted = @($found | Sort-Object -Property sent)
    $pick = $sorted | Where-Object { $_.has -and -not $_.auto } | Select-Object -Last 1
    if (-not $pick) { $pick = $sorted | Where-Object { -not $_.auto } | Select-Object -Last 1 }
    if (-not $pick) { $pick = $sorted | Select-Object -Last 1 }
    $mine = @(Get-MyAddresses $ns | ForEach-Object { $_.ToLowerInvariant() })
    $sentFolder = ''
    try { $sentFolder = [string]$ns.GetDefaultFolder(5).EntryID } catch {}
    $result = [ordered]@{ ok = $true }
    $chosen = Convert-Reply $pick.item $mine $sentFolder
    foreach ($k in $chosen.Keys) { $result[$k] = $chosen[$k] }
    $result['storeId'] = [string]$pick.item.Parent.StoreID
    $result['after'] = @($sorted | Where-Object { -not $_.auto -and $_.sent -gt $pick.sent } | Select-Object -Last $Later | ForEach-Object { Convert-Reply $_.item $mine $sentFolder })
    Write-Result $result
    exit 0
  }

  if ($Action -eq 'recipients') {
    $item = $ns.GetItemFromID($EntryId, $StoreId)
    $one = $item.Reply(); $all = $item.ReplyAll()
    $result = [ordered]@{
      ok       = $true
      subject  = [string]$one.Subject
      reply    = [ordered]@{ to = [string]$one.To; cc = [string]$one.CC }
      replyAll = [ordered]@{ to = [string]$all.To; cc = [string]$all.CC }
    }
    # Never saved: Close(1) is olDiscard.
    $one.Close(1); $all.Close(1)
    Write-Result $result
    exit 0
  }

  if ($Action -eq 'reply') {
    $item = $ns.GetItemFromID($EntryId, $StoreId)
    $draft = if ($ReplyAll) { $item.ReplyAll() } else { $item.Reply() }
    $text = [System.IO.File]::ReadAllText($BodyFile, $utf8)
    if ($draft.BodyFormat -eq 2) {
      # HTML (olFormatHTML): put the text first, above the quoted thread Outlook added.
      $html = ([System.Net.WebUtility]::HtmlEncode($text) -replace "`r?`n", '<br>')
      $body = [string]$draft.HTMLBody
      $m = [regex]::Match($body, '<body[^>]*>', 'IgnoreCase')
      $block = "<div>$html</div><br>"
      $draft.HTMLBody = if ($m.Success) { $body.Insert($m.Index + $m.Length, $block) } else { $block + $body }
    } else {
      $draft.Body = $text + "`r`n`r`n" + [string]$draft.Body
    }
    if ($Open) {
      # Shown in its own window for the user to finish; Outlook asks about saving if they close it. Never sent.
      $draft.Display()
      Write-Result ([ordered]@{ ok = $true })
      exit 0
    }
    # Save puts it in Drafts. It is never sent.
    $draft.Save()
    Write-Result ([ordered]@{ ok = $true; entryId = [string]$draft.EntryID; storeId = [string]$draft.Parent.StoreID })
    exit 0
  }

  if ($Action -eq 'calendar') {
    $parse = { param($s) [DateTime]::Parse($s, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToLocalTime() }
    $from = & $parse $Since
    $to = & $parse $Until
    $calendar = $ns.GetDefaultFolder(9)
    $items = $calendar.Items
    # Sort, then IncludeRecurrences, then Restrict: the order Outlook needs to list each occurrence of a repeating meeting.
    $items.Sort('[Start]')
    $items.IncludeRecurrences = $true
    # Restrict uses Outlook's own date format (the user's locale) and ignores seconds; calendar.ts filters exactly.
    $found = $items.Restrict("[Start] < '$($to.AddMinutes(1).ToString('g'))' AND [End] > '$($from.AddMinutes(-1).ToString('g'))'")
    $myAddresses = @(Get-MyAddresses $ns | ForEach-Object { ([string]$_).ToLower() })
    $myName = [string]$ns.CurrentUser.Name
    $responses = @{ 0 = 'none'; 1 = 'organizer'; 2 = 'tentative'; 3 = 'accepted'; 4 = 'declined'; 5 = 'none' }
    $busyNames = @{ 0 = 'free'; 1 = 'tentative'; 2 = 'busy'; 3 = 'away'; 4 = 'busy' }
    $events = New-Object System.Collections.ArrayList
    $item = $found.GetFirst()
    $guard = 0
    while ($item -ne $null -and $guard -lt 2000) {
      $guard++
      try {
        if ($item.Start -ge $to) { break }
        $attendees = New-Object System.Collections.ArrayList
        $count = 0
        $recipients = $item.Recipients
        foreach ($r in $recipients) {
          # Type 3 is a room or other resource, not a person.
          if ($r.Type -eq 3) { continue }
          $count++
          $address = Get-Prop $r 'http://schemas.microsoft.com/mapi/proptag/0x39FE001F'
          if (-not $address) { try { $address = [string]$r.Address } catch { $address = '' } }
          $isMe = ($address -and ($myAddresses -contains $address.ToLower())) -or ([string]$r.Name -eq $myName)
          if ($attendees.Count -lt 50 -or $isMe) {
            [void]$attendees.Add([ordered]@{ name = [string]$r.Name; email = $(if ($address -like '*@*') { $address } else { '' }); response = $responses[[int]$r.MeetingResponseStatus]; isMe = [bool]$isMe })
          }
        }
        $organizerName = [string]$item.Organizer
        $myResponse = $responses[[int]$item.ResponseStatus]
        if (-not $myResponse) { $myResponse = 'none' }
        # MeetingStatus 0 is an appointment with no one invited: the user's own entry.
        if ($item.MeetingStatus -eq 0) { $myResponse = 'organizer' }
        $body = ''
        try { $body = [string]$item.Body } catch {}
        if ($body.Length -gt 8000) { $body = $body.Substring(0, 8000) }
        [void]$events.Add([ordered]@{
          id            = "$([string]$item.EntryID)|$($item.Start.ToUniversalTime().ToString('o'))"
          entryId       = [string]$item.EntryID
          storeId       = [string]$calendar.StoreID
          title         = [string]$item.Subject
          start         = $item.Start.ToUniversalTime().ToString('o')
          end           = $item.End.ToUniversalTime().ToString('o')
          location      = [string]$item.Location
          allDay        = [bool]$item.AllDayEvent
          busy          = $(if ($busyNames.ContainsKey([int]$item.BusyStatus)) { $busyNames[[int]$item.BusyStatus] } else { 'unknown' })
          private       = ([int]$item.Sensitivity -ge 2)
          cancelled     = ([int]$item.MeetingStatus -eq 5 -or [int]$item.MeetingStatus -eq 7)
          myResponse    = $myResponse
          organizer     = [ordered]@{ name = $organizerName; email = ''; isMe = ($organizerName -eq $myName -or $myResponse -eq 'organizer') }
          attendees     = @($attendees)
          attendeeCount = $count
          invite        = $body
        })
      } catch {}
      $item = $found.GetNext()
    }
    Write-Result ([ordered]@{ ok = $true; events = @($events) })
    exit 0
  }

  if ($Action -eq 'openevent') {
    $item = $ns.GetItemFromID($EntryId, $StoreId)
    if ($item.IsRecurring -and $Start) {
      $when = [DateTime]::Parse($Start, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToLocalTime()
      try { $item = $item.GetRecurrencePattern().GetOccurrence($when) } catch {}
    }
    $item.Display()
    Write-Result ([ordered]@{ ok = $true })
    exit 0
  }


  $sinceLocal = [DateTime]::Parse($Since, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToLocalTime()
  # Restrict uses Outlook's own date format (the user's locale) and ignores seconds; outlook.ts filters exactly.
  $stamp = $sinceLocal.AddMinutes(-1).ToString('g')
  $messages = New-Object System.Collections.ArrayList

  function Read-Folder($folder, $path, $direction) {
    $field = if ($direction -eq 'sent') { 'SentOn' } else { 'ReceivedTime' }
    foreach ($item in $folder.Items.Restrict("[$field] >= '$stamp'")) {
      try { [void]$messages.Add((Convert-Item $item $path $direction)) } catch {}
    }
  }
  function Read-Tree($folder, $path) {
    Read-Folder $folder $path 'received'
    foreach ($sub in $folder.Folders) { Read-Tree $sub "$path/$($sub.Name)" }
  }

  $inbox = $ns.GetDefaultFolder(6)
  $sent = $ns.GetDefaultFolder(5)
  Read-Tree $inbox $inbox.Name
  Read-Folder $sent $sent.Name 'sent'

  $me = $ns.CurrentUser
  Write-Result ([ordered]@{ ok = $true; me = [ordered]@{ name = [string]$me.Name; addresses = @(Get-MyAddresses $ns) }; messages = @($messages) })
} catch {
  Write-Result ([ordered]@{ ok = $false; code = 'failed'; error = "Couldn't read Outlook: $($_.Exception.Message)" })
}
