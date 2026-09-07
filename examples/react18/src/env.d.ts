/// <reference types="vite/client" />

interface Window {
  __POWERED_BY_JIESHU__?: boolean;
  __JIESHU_MOUNT?: () => void;
  __JIESHU_UNMOUNT?: () => void;
  __JIESHU?: { mount: () => void };
  $jieshu?: {
    props?: { jump?: (name: string) => void };
    bus: { $emit: (event: string, message: string) => void };
  };
}
