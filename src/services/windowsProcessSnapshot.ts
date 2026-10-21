/** Read-only process parameters for same-user 64-bit processes; denied access stays unknown. */
export const windowsProcessSnapshot = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WlyProcessDirectory {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern bool IsWow64Process(IntPtr handle, out bool wow64);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr handle, IntPtr address, byte[] data, int size, out IntPtr read);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle, int kind, IntPtr info, int length, out int returned);
  static byte[] Read(IntPtr handle, IntPtr address, int size) {
    var data = new byte[size]; IntPtr read;
    return ReadProcessMemory(handle, address, data, size, out read) && read.ToInt64() == size ? data : null;
  }
  public static string Get(int pid) {
    if (IntPtr.Size != 8) return null;
    var handle = OpenProcess(0x410, false, pid);
    if (handle == IntPtr.Zero) return null;
    var info = Marshal.AllocHGlobal(48);
    try {
      bool wow64; int returned;
      if (!IsWow64Process(handle, out wow64) || wow64 || NtQueryInformationProcess(handle, 0, info, 48, out returned) != 0) return null;
      var peb = Marshal.ReadIntPtr(info, 8);
      var parameters = Read(handle, IntPtr.Add(peb, 0x20), 8);
      if (parameters == null) return null;
      var directory = Read(handle, new IntPtr(BitConverter.ToInt64(parameters, 0) + 0x38), 16);
      if (directory == null) return null;
      int length = BitConverter.ToUInt16(directory, 0);
      if (length == 0 || length > 65534 || length % 2 != 0) return null;
      var text = Read(handle, new IntPtr(BitConverter.ToInt64(directory, 8)), length);
      return text == null ? null : Encoding.Unicode.GetString(text);
    } catch { return null; }
    finally { Marshal.FreeHGlobal(info); CloseHandle(handle); }
  }
}
'@
@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine | ForEach-Object {
  $directory = $null
  if ($_.Name -match '^(node|nodejs|bun|deno|npm|pnpm|yarn)(\.exe)?$') { $directory = [WlyProcessDirectory]::Get([int]$_.ProcessId) }
  [pscustomobject]@{ ProcessId=$_.ProcessId; ParentProcessId=$_.ParentProcessId; Name=$_.Name; CommandLine=$_.CommandLine; Cwd=$directory }
}) | ConvertTo-Json -Compress
`;
