import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serverless 环境下 fs 读不到动态路径，需显式把文章 JSON 打进函数产物
  outputFileTracingIncludes: {
    "/api/articles": ["./daily-articles/**/*"],
  },
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
