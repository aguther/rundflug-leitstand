export const GIT_EXECUTABLE =
  process.platform === "win32" ? String.raw`C:\Program Files\Git\cmd\git.exe` : "/usr/bin/git";

export const WINDOWS_TASKKILL_EXECUTABLE = String.raw`C:\Windows\System32\taskkill.exe`;
