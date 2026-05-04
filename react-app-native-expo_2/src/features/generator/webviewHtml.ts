import { WEBVIEW_RUNNER_SCRIPT } from './webviewRunner.generated';

export function createGeneratorWebViewHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
    />
    <title>Paint by Numbers Runner</title>
  </head>
  <body>
    <script>
${WEBVIEW_RUNNER_SCRIPT}
    </script>
  </body>
</html>`;
}
