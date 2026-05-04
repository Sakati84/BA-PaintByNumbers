import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";

import { PIPELINE_HTML } from "./generated/pipelineHtml";
import type { PipelineBridgeEvent, PipelineImageSource, PipelineOptions } from "./PipelineTypes";

export type HiddenPipelineWebViewHandle = {
  loadImage: (requestId: string, image: PipelineImageSource) => void;
  runAll: (requestId: string, options: PipelineOptions) => void;
  reset: (requestId: string) => void;
};

type HiddenPipelineWebViewProps = {
  sourceUri: string | null;
  onEvent: (event: PipelineBridgeEvent) => void;
};

function withParentBridge(html: string): string {
  const bridgeScript = `
<script>
  (function () {
    window.ReactNativeWebView = {
      postMessage: function (message) {
        window.parent.postMessage(message, "*");
      }
    };
  })();
</script>`;

  return html.replace("<body>", `<body>${bridgeScript}`);
}

export const HiddenPipelineWebView = forwardRef<HiddenPipelineWebViewHandle, HiddenPipelineWebViewProps>(
  function HiddenPipelineWebView({ sourceUri, onEvent }, ref) {
    const frameRef = useRef<HTMLIFrameElement | null>(null);
    const srcDoc = useMemo(() => withParentBridge(PIPELINE_HTML), []);

    function post(command: unknown): void {
      frameRef.current?.contentWindow?.postMessage(JSON.stringify(command), "*");
    }

    function initializeBridge(): void {
      onEvent({ type: "STATUS", message: "Embedded web pipeline loaded, initializing JS pipeline" });
      window.setTimeout(() => {
        post({ type: "INIT", requestId: "webview-load" });
      }, 50);
    }

    useImperativeHandle(ref, () => ({
      loadImage(requestId, image) {
        post({ type: "LOAD_IMAGE", requestId, image });
      },
      runAll(requestId, options) {
        post({ type: "RUN_ALL", requestId, options });
      },
      reset(requestId) {
        post({ type: "RESET", requestId });
      },
    }));

    useEffect(() => {
      function handleWindowMessage(event: MessageEvent): void {
        if (event.source !== frameRef.current?.contentWindow) {
          return;
        }

        try {
          onEvent(JSON.parse(String(event.data)) as PipelineBridgeEvent);
        } catch {
          onEvent({
            type: "ERROR",
            message: `Invalid bridge message: ${String(event.data)}`,
          });
        }
      }

      window.addEventListener("message", handleWindowMessage);
      return () => window.removeEventListener("message", handleWindowMessage);
    }, [onEvent]);

    if (!sourceUri) {
      return null;
    }

    return (
      <View pointerEvents="none" style={styles.host}>
        <iframe
          ref={frameRef}
          srcDoc={srcDoc}
          onLoad={initializeBridge}
          style={styles.frame}
          title="Hidden pipeline"
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 24,
    height: 24,
    opacity: 0.01,
    overflow: "hidden",
  },
  frame: {
    width: 24,
    height: 24,
    borderWidth: 0,
    borderColor: "transparent",
  },
});
