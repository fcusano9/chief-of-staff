import { execFileSync } from 'node:child_process'

/** Where the benchmark's Anthropic key is stored: the Mac Keychain item, or the Windows Credential Manager entry. */
export const KEY_NAME = 'chief-of-staff-bench'

/**
 * Reads a generic credential from Windows Credential Manager through its own API (CredRead), so
 * nothing needs installing. bench/save-key.ps1 (`npm run bench:key`) stores one.
 */
const WINDOWS_READ = (name: string) => `
$sig = @'
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr credential);
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct Credential {
  public int Flags; public int Type; public string TargetName; public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
  public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
}
'@
Add-Type -MemberDefinition $sig -Namespace CosBench -Name Cred
$p = [IntPtr]::Zero
if ([CosBench.Cred]::CredRead('${name.replace(/'/g, "''")}', 1, 0, [ref]$p)) {
  $c = [Runtime.InteropServices.Marshal]::PtrToStructure($p, [type][CosBench.Cred+Credential])
  [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob, $c.CredentialBlobSize / 2))
  [CosBench.Cred]::CredFree($p)
}
`

/**
 * The Anthropic key for benchmarking Claude: ANTHROPIC_API_KEY if set, else the stored one (Mac
 * Keychain or Windows Credential Manager), else ''. Never the app's own key, which is encrypted
 * for the app.
 */
export function anthropicKey(name = KEY_NAME): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    if (process.platform === 'win32') {
      const script = Buffer.from(WINDOWS_READ(name), 'utf16le').toString('base64')
      return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    }
    return execFileSync('security', ['find-generic-password', '-s', name, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}
