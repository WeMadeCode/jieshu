/// <reference types="vite/client" />

interface Window {
  __POWERED_BY_JIESHU__?: boolean;
  __JIESHU_MOUNT?: () => void;
  __JIESHU_UNMOUNT?: () => void;
  __JIESHU?: { mount: () => void };
  $jieshu?: {
    location: Location;
    props?: {
      jump?: (name: string) => void;
      route?: string;
      message?: string;
      report?: (message: string) => void;
    };
    bus: {
      $emit: <Arguments extends unknown[]>(event: string, ...args: Arguments) => void;
      $on: <Arguments extends unknown[]>(event: string, callback: (...args: Arguments) => void) => void;
      $off: <Arguments extends unknown[]>(event: string, callback: (...args: Arguments) => void) => void;
    };
  };
}
