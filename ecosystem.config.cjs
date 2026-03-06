const appName = process.env.APP_NAME || "cubic";
const port = Number(process.env.PORT || 3002);

module.exports = {
  apps: [
    {
      name: appName,
      script: "node",
      args: "--import tsx server/index.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: String(port),
      },
    },
  ],
};
