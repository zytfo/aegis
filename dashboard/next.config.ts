import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // casper-js-sdk ships a CJS bundle that misbehaves when webpack re-bundles it
  // for the server (it corrupted JSON-RPC request bodies -> 413 from the node).
  // Keep it external so it loads as a plain Node CJS module at runtime.
  serverExternalPackages: ["casper-js-sdk"],
};

export default nextConfig;
