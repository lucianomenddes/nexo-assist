/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@nexo-assist/config",
    "@nexo-assist/contracts",
    "@nexo-assist/domain",
    "@nexo-assist/shared",
  ],
};

export default nextConfig;
