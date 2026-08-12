# RunBrowser

Control your Chrome browser via Model Context Protocol (MCP) using Chrome DevTools Protocol (CDP) events.

[**Install from Chrome Web Store**](https://chromewebstore.google.com/detail/@termio/browser-mcp/jfeammnjpkecdekppnclgkkffahnhfhe)

## What is RunBrowser?

RunBrowser is a Chrome extension that enables Playwright to connect to your existing Chrome instance without spawning a new browser or requiring Chrome to be started in CDP mode. This allows AI assistants and automation tools to interact with your browser seamlessly through the Model Context Protocol.

## Key Features

- **No new Chrome instances**: Works with your current browser session
- **No CDP mode required**: No need to restart Chrome with special flags
- **MCP integration**: Exposes browser control through the Model Context Protocol
- **CDP events**: Full access to Chrome DevTools Protocol capabilities
- **Playwright compatible**: Connect Playwright directly to your running Chrome

## How it Works

1. Install the extension in your Chrome browser
2. Click the extension icon to attach the debugger to the current tab
3. The extension creates a relay connection using CDP
4. Connect your MCP client (like Playwright) to control the browser
5. The icon changes color to indicate connection status:
   - Gray: Not connected
   - Green: Successfully connected

## Use Cases

- Browser automation without disrupting your workflow
- AI-assisted web browsing and testing
- Debugging and development with MCP-enabled tools
- Remote browser control for various applications

## Permissions

This extension requires the following permissions:

- **debugger**: To access Chrome DevTools Protocol
- **activeTab**: To interact with the current tab
- **tabs**: To manage browser tabs
- **all_urls**: To work with any website

## Getting Started

1. [Install the extension from the Chrome Web Store](https://chromewebstore.google.com/detail/@termio/browser-mcp/jfeammnjpkecdekppnclgkkffahnhfhe)
2. Navigate to any webpage
3. Click the RunBrowser extension icon
4. The debugger will attach and the icon will turn green when connected
5. Connect your MCP client to start controlling the browser

## Privacy & Security

RunBrowser runs locally in your browser and does not send any data to external servers. All browser control happens through the standard Chrome DevTools Protocol on your machine.

## Support

For issues, feature requests, or contributions, visit the [GitHub repository](https://github.com/runbrowser/runbrowser).

## License

Apache-2.0
