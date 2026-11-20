# Stores the Anthropic key for the benchmark in Windows Credential Manager, as the generic
# credential "chief-of-staff-bench" (bench/key.ts reads it). The key is typed hidden and never
# appears on screen, in the terminal's history, or on a command line.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File bench/save-key.ps1           # store or replace it
#   powershell -NoProfile -ExecutionPolicy Bypass -File bench/save-key.ps1 -Delete   # remove it
param([string]$Name = 'chief-of-staff-bench', [switch]$Delete)

$sig = @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct Credential {
  public int Flags; public int Type; public string TargetName; public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
  public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
}
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredWrite(ref Credential credential, int flags);
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredDelete(string target, int type, int flags);
'@
Add-Type -MemberDefinition $sig -Namespace CosBench -Name CredStore

if ($Delete) {
  if ([CosBench.CredStore]::CredDelete($Name, 1, 0)) { 'Removed.' } else { 'There was no stored key.' }
  return
}

$secure = Read-Host 'Anthropic API key' -AsSecureString
$key = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
if (-not $key) { 'Nothing was entered. No key was stored.'; return }

$blob = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni($key)
try {
  $c = New-Object CosBench.CredStore+Credential
  $c.Type = 1                       # generic
  $c.TargetName = $Name
  $c.UserName = 'anthropic'
  $c.CredentialBlob = $blob
  $c.CredentialBlobSize = $key.Length * 2
  $c.Persist = 2                    # this user, this computer
  if ([CosBench.CredStore]::CredWrite([ref]$c, 0)) { 'Saved.' } else { throw "Couldn't save the key (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))." }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($blob)
}
