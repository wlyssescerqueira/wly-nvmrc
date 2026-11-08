/**
 * Prints `port pid` for every TCP socket with no remote end (a listener), IPv4 and IPv6.
 * Reads the table straight from iphlpapi because some Windows builds report listeners
 * with an invalid state (0), and netstat then drops them or prints a bogus state.
 */
export const windowsTcpListeners = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class WlyTcpListeners {
  [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int family, int tableClass, uint reserved);
  static int Port(IntPtr row, int offset) { return (Marshal.ReadByte(row, offset) << 8) | Marshal.ReadByte(row, offset + 1); }
  static void Read(int family, int rowSize, int state, int localPort, int remotePort, int owner, List<string> output) {
    for (int attempt = 0; attempt < 3; attempt++) {
      int size = 0;
      GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, 5, 0);
      IntPtr buffer = Marshal.AllocHGlobal(size);
      try {
        uint result = GetExtendedTcpTable(buffer, ref size, false, family, 5, 0);
        if (result == 122) continue;
        if (result != 0) return;
        int count = Marshal.ReadInt32(buffer);
        for (int i = 0; i < count; i++) {
          IntPtr row = IntPtr.Add(buffer, 4 + i * rowSize);
          int pid = Marshal.ReadInt32(row, owner);
          // 2 = MIB_TCP_STATE_LISTEN; 0 is the invalid state those builds report for listeners.
          int status = Marshal.ReadInt32(row, state);
          if (pid > 0 && (status == 2 || status == 0) && Port(row, remotePort) == 0) output.Add(Port(row, localPort) + " " + pid);
        }
        return;
      } finally { Marshal.FreeHGlobal(buffer); }
    }
  }
  public static string[] Get() {
    var output = new List<string>();
    Read(2, 24, 0, 8, 16, 20, output);    // MIB_TCPROW_OWNER_PID
    Read(23, 56, 48, 20, 44, 52, output); // MIB_TCP6ROW_OWNER_PID
    return output.ToArray();
  }
}
'@
[WlyTcpListeners]::Get()
`;
