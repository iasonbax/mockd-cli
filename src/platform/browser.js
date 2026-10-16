// The one thing of the desktop the sign-in needs: opening a link in the person's browser. One
// command per system, run through the injected `run`.

// What cmd.exe would read as more than a link. `start` hands the address to cmd, so an address
// that carries one of these is refused, not quoted: the links the sign-in opens have none.
const CMD_SPECIAL = /[&|<>^"%\r\n]/;

export function openCommand(platform, url) {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") {
    if (CMD_SPECIAL.test(url)) throw new Error(`refusing to open ${url}: cmd.exe would read part of it as a command`);
    return ["cmd", ["/c", "start", "", url]];
  }
  return ["xdg-open", [url]];
}

export function browserFor({ platform, run }) {
  return {
    async open(url) {
      const [command, args] = openCommand(platform, url);
      const r = await run(command, args);
      if (r.code !== 0) throw new Error(`${command} failed (${r.code}): ${r.stderr.trim()}`);
    },
  };
}
