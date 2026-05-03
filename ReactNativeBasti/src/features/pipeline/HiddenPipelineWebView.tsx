import { forwardRef, useImperativeHandle, useRef } from "react";
import { StyleSheet, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";

import type { PipelineBridgeEvent, PipelineImageSource, PipelineOptions } from "./PipelineTypes";

const DIAGNOSTICS_SCRIPT = `
(function () {
  if (window.__paintPipelineDiagnosticsInstalled) {
    true;
    return;
  }
  window.__paintPipelineDiagnosticsInstalled = true;

  function post(message) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }
    } catch (error) {}
  }

  window.addEventListener("error", function (event) {
    post({
      type: "ERROR",
      message: "Hidden WebView JS error: " + (event.message || "Unknown script error."),
      stack: event.error && event.error.stack,
    });
  });

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    post({
      type: "ERROR",
      message:
        "Hidden WebView unhandled rejection: " +
        (reason && reason.message ? reason.message : String(reason || "unknown rejection")),
      stack: reason && reason.stack,
    });
  });

  if (typeof window.OffscreenCanvas === "undefined") {
    window.OffscreenCanvas = function OffscreenCanvas(width, height) {
      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
  }
  true;
})();
`;

export type HiddenPipelineWebViewHandle = {
  loadImage: (requestId: string, image: PipelineImageSource) => void;
  runAll: (requestId: string, options: PipelineOptions) => void;
  reset: (requestId: string) => void;
};

type HiddenPipelineWebViewProps = {
  sourceUri: string | null;
  onEvent: (event: PipelineBridgeEvent) => void;
};

export const HiddenPipelineWebView = forwardRef<HiddenPipelineWebViewHandle, HiddenPipelineWebViewProps>(
  function HiddenPipelineWebView({ sourceUri, onEvent }, ref) {
    const webViewRef = useRef<WebView>(null);

    function post(command: unknown): void {
      webViewRef.current?.postMessage(JSON.stringify(command));
    }

    function initializeBridge(): void {
      onEvent({ type: "STATUS", message: "Local compute page loaded" });
      setTimeout(() => {
        post({ type: "INIT", requestId: "webview-load" });
      }, 100);
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

    function handleMessage(event: WebViewMessageEvent): void {
      try {
        onEvent(JSON.parse(event.nativeEvent.data) as PipelineBridgeEvent);
      } catch {
        onEvent({
          type: "ERROR",
          message: `Invalid bridge message: ${event.nativeEvent.data}`,
        });
      }
    }

    if (!sourceUri) {
      return null;
    }

    const readAccessUrl = sourceUri.slice(0, sourceUri.lastIndexOf("/") + 1);

    return (
      <View pointerEvents="none" style={styles.host}>
        <WebView
          ref={webViewRef}
          source={{ uri: sourceUri }}
          allowingReadAccessToURL={readAccessUrl}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
          mixedContentMode="always"
          cacheEnabled={false}
          injectedJavaScriptBeforeContentLoaded={DIAGNOSTICS_SCRIPT}
          injectedJavaScript={DIAGNOSTICS_SCRIPT}
          onLoadStart={() => onEvent({ type: "STATUS", message: "Loading local WebView file" })}
          onLoadProgress={(event) =>
            onEvent({
              type: "STATUS",
              message: `Loading local WebView file ${Math.round(event.nativeEvent.progress * 100)}%`,
            })
          }
          onLoadEnd={initializeBridge}
          onMessage={handleMessage}
          onError={(event) =>
            onEvent({
              type: "ERROR",
              message: event.nativeEvent.description || "Hidden WebView failed to load.",
            })
          }
          onHttpError={(event) =>
            onEvent({
              type: "ERROR",
              message: `Hidden WebView HTTP ${event.nativeEvent.statusCode}: ${event.nativeEvent.description}`,
            })
          }
          onContentProcessDidTerminate={() =>
            onEvent({
              type: "ERROR",
              message: "Hidden WebView content process terminated while loading the pipeline.",
            })
          }
          style={styles.webview}
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
  webview: {
    width: 24,
    height: 24,
  },
});
