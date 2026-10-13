# Security policy

## Supported versions

Only the latest release of the Xbox integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-xbox](https://github.com/prohand/gladys-xbox/security), then
**Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove tokens, passwords, Live IDs and addresses first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), the
Xbox consoles and the Microsoft / Xbox Live services the integration talks to.

## What the integration keeps

- The Microsoft account password never reaches the integration: the sign-in
  happens on Microsoft's page, and only a **refresh token** is stored, in an
  internal Gladys configuration key that is never sent to the browser.
- The Azure client secret is a `secret` field: Gladys never sends it back to the
  browser.
- Tokens and secrets are never written to the logs.

## Good practices for users

- Create a dedicated Azure application for Gladys, and delete its client secret
  (or the application) to cut the access at once.
- You can also revoke the access from your Microsoft account
  (account.microsoft.com → Privacy → Apps and services).
- Keep Gladys and the integration up to date.
