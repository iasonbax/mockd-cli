// The machine's name as the API takes it: at most 80 characters. The sign-in in the browser
// sends it, and a person recognizes the machine by it when confirming. The name itself comes
// from the system (platform/machine-name.js) and is only cut here, never replaced.
export const MACHINE_NAME_MAX = 80;

export const machineField = (name) => name.slice(0, MACHINE_NAME_MAX);

// The operating system as the API names it: Go's names (`runtime.GOOS`), so Node's `win32` is
// `windows` there.
export const osField = (platform) => (platform === "win32" ? "windows" : platform);

// The user mockd runs as, as the API takes it (`os_user`): without a control character or white
// space around it, at most 64 characters. A user without a name is an error, not a stand-in.
export const OS_USER_MAX = 64;

export function userField(name) {
  const user = name.replace(/\p{Cc}/gu, "").trim();
  if (user === "") throw new Error("the user mockd runs as has no name");
  return Array.from(user).slice(0, OS_USER_MAX).join("");
}
