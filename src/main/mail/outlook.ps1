# Reads mail from classic Outlook over COM for Chief of Staff (see outlook.ts).
# Read-only except -Action open (displays one message) and -Action reply (saves a reply to Drafts, or shows it).
# Never sends, moves, flags or deletes.
#   -Action list -Since <ISO time> -OutFile <path>   writes received (Inbox and subfolders) and sent mail as JSON
#   -Action open -EntryId <id> -StoreId <id> -OutFile <path>   shows the message in Outlook
#   -Action latest -EntryId <id> -StoreId <id> -OutFile <path>   the newest sent or received email in that message's conversation
#   -Action recipients -EntryId <id> -StoreId <id> -OutFile <path>   who Reply and Reply all would go to (nothing is saved)
#   -Action reply -EntryId <id> -StoreId <id> -BodyFile <path> [-ReplyAll] [-Open] -OutFile <path>   saves a reply to Drafts, or with -Open shows it in a window instead; never sends
#   -Action me -OutFile <path>   the mailbox's email addresses
# The result is always JSON in -OutFile: { ok: true, ... } or { ok: false, error, code }.
param(
  [Parameter(Mandatory = $true)][ValidateSet('list', 'open', 'latest', 'recipients', 'reply', 'me')][string]$Action,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$Since,
  [string]$EntryId,
  [string]$StoreId,
  [string]$BodyFile,
  [switch]$ReplyAll,
  [switch]$Open,
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
    # Walks the message's conversation (Outlook's own threading, across folders) for the newest
    # email that was actually sent: drafts and Deleted Items are left out. Falls back to the message
    # itself when the store doesn't support conversations.
    $item = $ns.GetItemFromID($EntryId, $StoreId)
    $best = $item
    $skipFolders = @()
    foreach ($n in 3, 16) { try { $skipFolders += [string]$ns.GetDefaultFolder($n).EntryID } catch {} }
    $conv = $null
    try { $conv = $item.GetConversation() } catch {}
    if ($conv) {
      $stack = New-Object System.Collections.Stack
      foreach ($root in $conv.GetRootItems()) { $stack.Push($root) }
      while ($stack.Count -gt 0) {
        $node = $stack.Pop()
        try { foreach ($child in $conv.GetChildren($node)) { $stack.Push($child) } } catch {}
        try {
          if ($node.Class -ne 43 -or -not $node.Sent) { continue }
          if ($skipFolders -contains [string]$node.Parent.EntryID) { continue }
          if ($node.SentOn -gt $best.SentOn) { $best = $node }
        } catch {}
      }
    }
    $mine = @(Get-MyAddresses $ns | ForEach-Object { $_.ToLowerInvariant() })
    $sentFolder = ''
    try { $sentFolder = [string]$ns.GetDefaultFolder(5).EntryID } catch {}
    $fromEmail = Get-SenderEmail $best
    $fromMe = ([string]$best.Parent.EntryID -eq $sentFolder) -or ($mine -contains $fromEmail.ToLowerInvariant())
    $body = ''
    try { $body = [string]$best.Body } catch {}
    if ($body.Length -gt $MaxBody) { $body = $body.Substring(0, $MaxBody) }
    $to = ''; $cc = ''
    try { $to = [string]$best.To; $cc = [string]$best.CC } catch {}
    Write-Result ([ordered]@{
      ok      = $true
      entryId = [string]$best.EntryID
      storeId = [string]$best.Parent.StoreID
      fromMe  = [bool]$fromMe
      from    = [string]$best.SenderName
      to      = $to
      cc      = $cc
      subject = [string]$best.Subject
      time    = $best.SentOn.ToUniversalTime().ToString('o')
      body    = $body
    })
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
