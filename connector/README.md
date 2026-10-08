# CartPilot local Zepto MCP connector (Windows)

The hosted Netlify app is still a standalone shopping-list validator. Run this connector **on the same computer where you open CartPilot** to use Zepto MCP.

## Requirements

- Windows 10/11 with Node.js 20+ and npm/npx installed
- A real Zepto account and delivery address
- Browser access to complete Zepto's official sign-in
- Zepto MCP compatibility with the local MCP client and the relevant tool schemas (not yet verified live)

## Install and start

1. Download or clone: `https://github.com/Himil-Kansara/cartpilot-zepto-agent`
2. Open PowerShell in the project folder.
3. Run `npm install`
4. Run `npm test`
5. Run `npm start`
6. Open `http://127.0.0.1:8787` on **that same laptop**.

Keep the PowerShell window running. Click **Connect Zepto account** on the localhost page, complete Zepto login through the browser opened by the official `mcp-remote` client, and use **Fetch missing / unverified prices**.

The search adapter accepts only an unambiguous exact product name, identifiable product ID, and a verifiable current unit selling price from Zepto. If the MCP tool name, input schema or response differs, the connector stops safely and shows an error. Consult `http://127.0.0.1:8787/api/status` for tool availability; the `/api/tools` endpoint requires a local session token. Never guess input fields or use unofficial Zepto endpoints.

After live verification, items costing ₹100 or less are **automatically selected in the local prepared list**. Click **Add verified items to real Zepto cart** and confirm to send cart-add requests through official MCP tools. This makes cart changes but **does not submit the order**. Check the actual Zepto cart on zepto.com (or its official app), verify quantities and final total, and pay directly there. Prices can change at checkout.

### Security

- Binds to loopback `127.0.0.1:8787`, not the public internet
- Only same-origin JSON actions with a per-run random session token
- No raw arbitrary tool-execution endpoint
- Never stores Zepto session tokens, account passwords or OTPs in the application
- Never asks for card details or UPI PIN
- Requires explicit user confirmation before modifying the real cart
- No checkout or payment tool is invoked
- Cart-add requests are not automatically retried because duplicate additions are possible
- Backend memory references expire after 5 minutes

### Limitations

The Zepto MCP server's actual tool names, OAuth callback behavior, and response fields can change. **A live account test has not been performed**. The connector deliberately refuses to proceed when exact matching or schema interpretation is uncertain. Product URL alone is not a guaranteed lookup identifier; you may need to supply the exact product name and pack size. Zepto may impose platform or catalog restrictions. Browser/desktop OAuth sign-in must be completed by the account holder.
