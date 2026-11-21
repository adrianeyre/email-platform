/**
 * Pen test I1 (#102): the browser and the second origin the framing and cookie probes need. The second origin is a
 * plain Node server on another port of the same host, standing in for any other service a LAN host name serves (a
 * router page, a NAS, a dev server). It records the Cookie header of every request it gets, and serves the pages a
 * hostile service on that host would: one that frames the platform, one that plants a cookie, and one that posts a form
 * to the platform. Nothing here touches product code.
 */
import { createServer, type Server as HttpServer } from "node:http";
import {
  createServer as createTcpServer,
  type Server as TcpServer,
} from "node:net";
import type { Browser } from "playwright-core";

const listenOnFreePort = async (
  server: HttpServer | TcpServer,
): Promise<number> => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The server has no TCP port");
  }
  return address.port;
};

const closeServer = (server: HttpServer | TcpServer): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });

export interface RefusingSmtp {
  port: number;
  close: () => Promise<void>;
}

/**
 * An SMTP provider that greets, says hello, and refuses every sender with `reply`, as a real provider refuses an account
 * it has suspended or a relay it doesn't allow. Its replies name an internal host, an address and an account, the kind
 * of text a real provider's refusal carries.
 */
export const startRefusingSmtp = async (
  reply: string,
): Promise<RefusingSmtp> => {
  const server = createTcpServer((socket) => {
    socket.on("error", () => undefined);
    socket.write("220 smtp-7.internal.provider.example ESMTP\r\n");
    socket.on("data", (data) => {
      const line = data.toString("utf8");
      if (/^(EHLO|HELO)/iu.test(line)) {
        socket.write("250-smtp-7.internal.provider.example\r\n250 OK\r\n");
      } else if (/^MAIL/iu.test(line)) {
        socket.write(`${reply}\r\n`);
      } else if (/^QUIT/iu.test(line)) {
        socket.end("221 Bye\r\n");
      } else {
        socket.write("250 OK\r\n");
      }
    });
  });
  const port = await listenOnFreePort(server);
  return { port, close: () => closeServer(server) };
};

/**
 * Chrome, as `site/stageshow/scripts/browser.mjs` finds it: `CHROME_PATH`, or the installed Chrome. `args` are Chrome's
 * own switches, such as `--host-resolver-rules` to reach this machine by another host name.
 */
export const launchBrowser = async (
  args: string[] = [],
): Promise<Browser | undefined> => {
  try {
    const { chromium } = await import("playwright-core");
    const path = process.env.CHROME_PATH;
    return await chromium.launch(
      path === undefined
        ? { channel: "chrome", args }
        : { executablePath: path, args },
    );
  } catch {
    return undefined;
  }
};

/**
 * The stand-in UI's page. Like the real UI, it is one `index.html` the SPA fallback serves for `/users` and
 * `/api-keys`, and it reads the signed-in User's data from `/app` with the session cookie. It writes what it read into
 * the page, so a probe can see what a frame shows.
 */
export const standInIndexHtml = `<!doctype html>
<html><head><title>Email platform</title></head><body><pre id="out">loading</pre>
<script>
Promise.all(["/app/me", "/app/users", "/app/api-keys"].map((url) =>
  fetch(url).then((response) => response.text().then((body) => response.status + " " + url + " " + body))
)).then((lines) => { document.getElementById("out").textContent = "loaded\\n" + lines.join("\\n"); });
</script></body></html>`;

export interface OtherOrigin {
  port: number;
  /** The Cookie header of every request this origin got, in order. */
  cookiesSeen: string[];
  /** The `Set-Cookie` header, or headers, the `/plant` page answers with. */
  plantCookie: (setCookie: string | string[]) => void;
  close: () => Promise<void>;
}

/**
 * Starts the second origin on 127.0.0.1 and a free port. Its pages:
 * - `/frame?src=<url>` frames `src` full-size, as a clickjacking page would.
 * - `/plant` answers with the `Set-Cookie` given to `plantCookie`.
 * - `/post?action=<url>&body=<text>` posts `body` to `action` as a `text/plain` form, the one way a page on another
 *   origin can send a body a JSON route might take without asking first.
 * - anything else is an empty page.
 */
export const startOtherOrigin = async (): Promise<OtherOrigin> => {
  const cookiesSeen: string[] = [];
  let planted: string | string[] = "";
  const server: HttpServer = createServer((request, response) => {
    cookiesSeen.push(request.headers.cookie ?? "");
    const url = new URL(request.url ?? "/", "http://other.invalid");
    const escape = (value: string) =>
      value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/frame") {
      response.end(
        `<!doctype html><iframe id="target" src="${escape(url.searchParams.get("src") ?? "")}" style="width:100%;height:600px"></iframe>`,
      );
      return;
    }
    if (url.pathname === "/plant") {
      response.setHeader("set-cookie", planted);
      response.end("<!doctype html><p>planted</p>");
      return;
    }
    if (url.pathname === "/post") {
      response.end(
        `<!doctype html><form id="f" method="POST" enctype="text/plain" action="${escape(url.searchParams.get("action") ?? "")}"><input name="${escape(url.searchParams.get("body") ?? "")}" value=""></form><script>document.getElementById("f").submit()</script>`,
      );
      return;
    }
    response.end("<!doctype html><p>another service on this host</p>");
  });
  const port = await listenOnFreePort(server);
  return {
    port,
    cookiesSeen,
    plantCookie: (setCookie) => {
      planted = setCookie;
    },
    close: () => {
      server.closeAllConnections();
      return closeServer(server);
    },
  };
};
