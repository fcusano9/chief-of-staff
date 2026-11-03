# Reads mail from classic Outlook over COM for Chief of Staff (see outlook.ts).
# Read-only except -Action open, which displays one message. Never sends, moves, flags or deletes.
#   -Action list -Since <ISO time> -OutFile <path>   writes received (Inbox and subfolders) and sent mail as JSON
#   -Action open -EntryId <id> -StoreId <id> -OutFile <path>   shows the message in Outlook
# The result is always JSON in -OutFile: { ok: true, ... } or { ok: false, error, code }.
param(
  [Parameter(Mandatory = $true)][ValidateSet('list', 'open')][string]$Action,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$Since,
  [string]$EntryId,
  [string]$StoreId,
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

try {
  try {
    $outlook = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
  } catch {
    Write-Result ([ordered]@{ ok = $false; code = 'not_running'; error = "Outlook isn't running. Open Outlook, then try again." })
    exit 0
  }
  $ns = $outlook.GetNamespace('MAPI')

  if ($Action -eq 'open') {
    $item = $ns.GetItemFromID($EntryId, $StoreId)
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
  $addresses = New-Object System.Collections.ArrayList
  try { $u = $me.AddressEntry.GetExchangeUser(); if ($u) { [void]$addresses.Add([string]$u.PrimarySmtpAddress) } } catch {}
  try { [void]$addresses.Add([string]$me.Address) } catch {}
  foreach ($account in $ns.Accounts) { try { [void]$addresses.Add([string]$account.SmtpAddress) } catch {} }

  Write-Result ([ordered]@{ ok = $true; me = [ordered]@{ name = [string]$me.Name; addresses = @($addresses) }; messages = @($messages) })
} catch {
  Write-Result ([ordered]@{ ok = $false; code = 'failed'; error = "Couldn't read Outlook: $($_.Exception.Message)" })
}
