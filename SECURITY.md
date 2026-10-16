# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: open the repository's **Security** tab, choose **Report a
vulnerability** (private vulnerability reporting), and describe what you found. Please include

- what is affected (a command, a release file, a workflow),
- the steps to reproduce it, and the version (`mockd --version`) and system you used,
- what an attacker could do with it.

Only the maintainers can read the report. Please give us the chance to fix the problem before you
publish details.

## What counts

Anything in this repository that could harm a person who runs `mockd`: leaking or misusing the stored
access or the playground tokens, sending a request the sign-in should not send, running a command
from a server's answer, or a release file that does not match its `SHA256SUMS`.

Found a secret that was committed by mistake? Report it the same way.
