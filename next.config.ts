import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "run-agent-6a7b4d11b367725e6162b48d-mtss8jlq-preview.agent-sandbox-bj-a1-gw.traecontent.cn",
    "*.agent-sandbox-bj-a1-gw.traecontent.cn",
    "*.traecontent.cn",
    "*.remote-agent.svc.cluster.local",
  ],
};

export default nextConfig;
