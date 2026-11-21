# Base images are pinned by digest (pen test I4, #183): bump the tag and digest together, as
# docs/operations/deploying.md, "Updating an image", describes. Both stages name the same image.
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS build
WORKDIR /app
RUN npm install -g pnpm@12.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json vite.config.ts ./
COPY src ./src
RUN pnpm run build && pnpm prune --prod

FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/drizzle ./src/drizzle
USER node
EXPOSE 4320
ENTRYPOINT ["node", "--enable-source-maps"]
CMD ["dist/src/index.js", "api"]
