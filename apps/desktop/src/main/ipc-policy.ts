import { IPC_INVOKE_CHANNEL_NAMES } from "@author-copilot/contracts";

const allowedInvokeChannels = new Set<string>(IPC_INVOKE_CHANNEL_NAMES);

export interface IpcRequestContext {
  readonly channel: string;
  readonly senderFrameUrl: string;
  readonly mainFrameUrl: string;
  readonly trustedRendererUrl: string;
  readonly isMainFrame: boolean;
  readonly args: readonly unknown[];
  readonly expectedArgumentCount?: number;
}

function canonicalUrl(value: string): string | undefined {
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

export function assertTrustedIpcRequest(context: IpcRequestContext): void {
  if (!allowedInvokeChannels.has(context.channel)) {
    throw new Error("IPC channel is not allowed");
  }

  const senderUrl = canonicalUrl(context.senderFrameUrl);
  const mainFrameUrl = canonicalUrl(context.mainFrameUrl);
  const trustedUrl = canonicalUrl(context.trustedRendererUrl);

  if (
    !context.isMainFrame ||
    senderUrl === undefined ||
    senderUrl !== mainFrameUrl ||
    senderUrl !== trustedUrl
  ) {
    throw new Error("IPC sender is not trusted");
  }

  const expectedArgumentCount = context.expectedArgumentCount ?? 0;
  if (context.args.length !== expectedArgumentCount) {
    throw new Error(
      expectedArgumentCount === 0
        ? "IPC request does not accept arguments"
        : "IPC request has an invalid argument count",
    );
  }
}
