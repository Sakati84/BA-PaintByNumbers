import type {
  WebViewAppRequest,
  WebViewHostEvent,
} from '../../../App/src/features/webview/appWebViewBridgeTypes';

type EventHandler = (event: WebViewHostEvent) => void;

function parseBridgeEvent(value: string): WebViewHostEvent | null {
  try {
    return JSON.parse(value) as WebViewHostEvent;
  } catch {
    return null;
  }
}

export class WebViewBridge {
  private handlers = new Set<EventHandler>();

  constructor() {
    const listener = (rawValue: unknown) => {
      const event = parseBridgeEvent(String(rawValue ?? ''));
      if (event == null) {
        return;
      }
      this.handlers.forEach((handler) => handler(event));
    };

    window.addEventListener('message', (event) => {
      listener(event.data);
    });

    document.addEventListener('message', ((event: Event) => {
      const messageEvent = event as MessageEvent<string>;
      listener(messageEvent.data);
    }) as EventListener);
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  send(request: WebViewAppRequest): void {
    window.ReactNativeWebView?.postMessage(JSON.stringify(request));
  }
}

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}
