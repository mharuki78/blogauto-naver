const nextConfig = {
  agentRules: false,
  serverExternalPackages: ["playwright-core", "@browserbasehq/sdk"],
  outputFileTracingIncludes: {
    "/api/publish": ["./node_modules/playwright-core/**/*"],
    "/api/session": ["./node_modules/playwright-core/**/*"],
  },
};

export default nextConfig;
