declare module '*.png' {
  const src: string;
  export default src;
}

declare module 'react' {
  export type ReactNode = any;
  export type FormEvent<T = Element> = {
    target: T;
    currentTarget: T;
  };
  export type ChangeEvent<T = Element> = {
    target: T;
    currentTarget: T;
  };
  export function useState<S>(initialState: S | (() => S)): [S, (value: S | ((previousState: S) => S)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useRef<T>(initialValue: T): { current: T };
  export const StrictMode: any;
  const React: any;
  export default React;
}

declare module 'react-dom/client' {
  export function createRoot(container: Element | DocumentFragment): {
    render(children: any): void;
  };
}

declare module 'react/jsx-runtime' {
  export const Fragment: any;
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: any;
  }
}
