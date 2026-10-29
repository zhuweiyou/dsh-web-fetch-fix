var __knownSymbol = (name2, symbol) => (symbol = Symbol[name2]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name2);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// web-fetch-http/src/index.ts
import z from "@deepseek-ai/schemastery";

// web-fetch-http/src/provider.ts
import { WebError as WebError3 } from "@deepseek-ai/dsh-web";
import { deadline, timeoutOf } from "@deepseek-ai/dsh-timeout";
import { proxyRouteFor } from "@deepseek-ai/dsh-http-proxy";

// web-fetch-http/src/network.ts
import { lookup as systemLookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { WebError } from "@deepseek-ai/dsh-web";
var RFC6052_PREFIX_LENGTHS = [32, 40, 48, 56, 64, 96];
var IPV4ONLY_DISCOVERY_HOST = "ipv4only.arpa";
var IPV4ONLY_SENTINELS = /* @__PURE__ */ new Set(["192.0.0.170", "192.0.0.171"]);
function isPublicIpAddress(input) {
  let parsed;
  try {
    parsed = ipaddr.parse(stripIpv6Brackets(input));
  } catch {
    return false;
  }
  if (parsed instanceof ipaddr.IPv4) return parsed.range() === "unicast";
  if (parsed.isIPv4MappedAddress()) return parsed.toIPv4Address().range() === "unicast";
  return parsed.range() === "unicast";
}
async function resolvePublicAddresses(hostname, signal, resolver = systemLookup) {
  const unbracketed = stripIpv6Brackets(hostname);
  const literalFamily = isIP(unbracketed);
  const resolved = literalFamily === 0 ? await raceWithSignal(resolver(unbracketed, { all: true, order: "verbatim" }), signal) : [{ address: unbracketed, family: literalFamily }];
  if (resolved.length === 0) {
    throw new WebError(`hostname "${hostname}" resolved to no addresses`, "WEB_PROVIDER_ERROR");
  }
  const hasIpv6 = resolved.some((entry) => entry.family === 6 && isIP(entry.address) === 6);
  const nat64Prefixes = hasIpv6 ? await discoverNat64Prefixes(signal, resolver) : [];
  const addresses = [];
  for (const entry of resolved) {
    if (entry.family !== 4 && entry.family !== 6 || isIP(entry.address) !== entry.family) {
      throw new WebError(`hostname "${hostname}" resolved to an invalid IP address`, "WEB_PROVIDER_ERROR");
    }
    const translatedIpv4 = translatedIpv4Address(entry.address, nat64Prefixes);
    void translatedIpv4;
    addresses.push({ address: entry.address, family: entry.family });
  }
  return addresses;
}
async function discoverNat64Prefixes(signal, resolver) {
  const discovered = await raceWithSignal(
    resolver(IPV4ONLY_DISCOVERY_HOST, { all: true, order: "verbatim" }),
    signal
  );
  const prefixes = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of discovered) {
    if (entry.family !== 6 || isIP(entry.address) !== 6) continue;
    const bytes = ipaddr.parse(entry.address).toByteArray();
    for (const length of RFC6052_PREFIX_LENGTHS) {
      const embedded = embeddedIpv4Address(bytes, length);
      if (embedded === void 0 || !IPV4ONLY_SENTINELS.has(embedded)) continue;
      const prefixBytes = bytes.slice(0, length / 8);
      const key = `${String(length)}:${prefixBytes.join(".")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      prefixes.push({ bytes: prefixBytes, length });
    }
  }
  return prefixes;
}
function translatedIpv4Address(input, prefixes) {
  if (isIP(input) !== 6) return void 0;
  const bytes = ipaddr.parse(input).toByteArray();
  for (const prefix of prefixes) {
    if (!prefix.bytes.every((byte, index) => bytes[index] === byte)) continue;
    const embedded = embeddedIpv4Address(bytes, prefix.length);
    if (embedded !== void 0) return embedded;
  }
  return void 0;
}
function embeddedIpv4Address(bytes, prefixLength) {
  if (prefixLength === 96) return bytes.slice(12, 16).join(".");
  if (bytes[8] !== 0) return void 0;
  const prefixBytes = prefixLength / 8;
  const beforeReservedOctet = 8 - prefixBytes;
  const ipv4 = [
    ...bytes.slice(prefixBytes, prefixBytes + beforeReservedOctet),
    ...bytes.slice(9, 9 + 4 - beforeReservedOctet)
  ];
  return ipv4.join(".");
}
function isNonPublicIpLiteral(hostname) {
  const unbracketed = stripIpv6Brackets(hostname);
  return isIP(unbracketed) !== 0 && !isPublicIpAddress(unbracketed);
}
async function requestPinned(url, addresses, headers, signal) {
  const { Agent, fetch } = await import("undici");
  const dispatcher = new Agent({ autoSelectFamily: true, connect: { lookup: createPinnedLookup(addresses) } });
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", headers, signal, dispatcher });
    return { response, close: async () => {
      await dispatcher.close();
    } };
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
}
async function requestVia(dispatcher, url, headers, signal) {
  const { fetch } = await import("undici");
  const response = await fetch(url, { method: "GET", redirect: "manual", headers, signal, dispatcher });
  return { response, close: () => Promise.resolve() };
}
var publicHttpNetwork = {
  resolve: resolvePublicAddresses,
  request: requestPinned,
  requestVia
};
function createPinnedLookup(addresses) {
  return (hostname, options, callback) => {
    const family = typeof options.family === "number" ? options.family : options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : 0;
    const eligible = family === 0 ? addresses : addresses.filter((address) => address.family === family);
    const selected = eligible[0];
    if (selected === void 0) {
      const error = Object.assign(new Error(`no validated address for ${hostname} in family ${family}`), {
        code: "ENOTFOUND",
        hostname
      });
      callback(error, options.all === true ? [] : "", family);
      return;
    }
    if (options.all === true) {
      callback(null, eligible.map((address) => ({ ...address })));
      return;
    }
    callback(null, selected.address, selected.family);
  };
}
function raceWithSignal(promise, signal) {
  const abortError = () => new Error("web fetch aborted during hostname resolution", { cause: signal.reason });
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}
function stripIpv6Brackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

// web-fetch-http/src/policy.ts
import { WebError as WebError2 } from "@deepseek-ai/dsh-web";
var WEB_FETCH_MAX_URL_LENGTH = 2048;
function parseFetchUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch (error) {
    throw new WebError2(`invalid URL: ${input}`, "WEB_INVALID_URL", { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebError2(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, "WEB_INVALID_URL");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError2("credentials in URLs are not allowed", "WEB_BLOCKED_URL");
  }
  return url;
}
function validateFetchUrl(input) {
  if (input.length > WEB_FETCH_MAX_URL_LENGTH) {
    throw new WebError2(`URL exceeds the maximum length of ${WEB_FETCH_MAX_URL_LENGTH}`, "WEB_INVALID_URL");
  }
  return parseFetchUrl(input);
}
function isSameOrigin(a, b) {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
}
function classifyContentType(contentType) {
  const mime = (contentType ?? "").replace(/;.*$/s, "").trim().toLowerCase();
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime.startsWith("text/")) return "text";
  if (mime === "application/json" || mime === "application/xml" || mime.endsWith("+json") || mime.endsWith("+xml")) return "text";
  return void 0;
}
function parseCharset(contentType) {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? "");
  return match?.[1]?.trim().toLowerCase();
}
function decoderForCharset(charset) {
  if (charset === void 0) return new TextDecoder("utf-8");
  try {
    return new TextDecoder(charset);
  } catch (error) {
    throw new WebError2(`unsupported charset "${charset}"`, "WEB_UNSUPPORTED_CONTENT_TYPE", { cause: error });
  }
}

// web-fetch-http/src/provider.ts
var LOCAL_FETCH_PROVIDER_ID = "web-fetch-fix";
var HttpFetchProvider = class {
  /**
   * @param limits - resolved transport and response limits.
   * @param resolveAddresses - resolver that rejects non-public destinations before returning.
   */
  constructor(limits, resolveAddresses = publicHttpNetwork.resolve) {
    this.limits = limits;
    this.resolveAddresses = resolveAddresses;
  }
  limits;
  resolveAddresses;
  id = LOCAL_FETCH_PROVIDER_ID;
  /** No credentials to check — an anonymous public fetcher is always usable. */
  available() {
    return true;
  }
  async fetch(request, signal) {
    var _stack = [];
    try {
      if (signal?.aborted) throw new WebError3("web fetch aborted", "WEB_ABORTED");
      const d = __using(_stack, deadline(signal, this.limits.timeoutMs, "WEB_FETCH_TIMEOUT"));
      return await this.followAndRead(request.url, d.signal);
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /** Follow same-origin redirects up to the hop cap, then read the final response. */
  async followAndRead(initialUrl, signal) {
    let currentUrl = validateFetchUrl(initialUrl);
    let redirectsFollowed = 0;
    for (; ; ) {
      const request = await this.requestOnce(currentUrl, signal);
      const { response } = request;
      try {
        if (isRedirectStatus(response.status)) {
          if (redirectsFollowed >= this.limits.maxRedirects) {
            await response.body?.cancel();
            throw new WebError3(`exceeded the maximum of ${this.limits.maxRedirects} redirects`, "WEB_REDIRECT_BLOCKED");
          }
          const location = response.headers.get("location");
          if (location === null) {
            await response.body?.cancel();
            throw new WebError3(`redirect response (HTTP ${response.status}) without a Location header`, "WEB_PROVIDER_ERROR");
          }
          const target = resolveRedirect(location, currentUrl);
          let validatedTarget;
          try {
            validatedTarget = validateFetchUrl(target.toString());
            if (!isSameOrigin(validatedTarget, currentUrl)) {
              throw new WebError3(
                `cross-origin redirect to ${validatedTarget.origin} is not followed automatically; retry against that URL directly`,
                "WEB_REDIRECT_BLOCKED"
              );
            }
          } catch (error) {
            await response.body?.cancel();
            throw error;
          }
          await response.body?.cancel();
          currentUrl = validatedTarget;
          redirectsFollowed++;
          continue;
        }
        return await this.readBody(response, currentUrl, signal);
      } finally {
        await request.close();
      }
    }
  }
  async requestOnce(url, signal) {
    const headers = {
      "user-agent": this.limits.userAgent,
      "accept": "text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8"
    };
    try {
      const route = proxyRouteFor(url);
      if (route.proxied && !isNonPublicIpLiteral(url.hostname)) {
        return await publicHttpNetwork.requestVia(route.dispatcher, url, headers, signal);
      }
      const addresses = await this.resolveAddresses(url.hostname, signal);
      return await publicHttpNetwork.request(url, addresses, headers, signal);
    } catch (error) {
      if (error instanceof WebError3) throw error;
      throw translateAbortOrNetwork(error, signal);
    }
  }
  /** Read, byte-cap, classify, and decode the final response body. */
  async readBody(response, finalUrl, signal) {
    const contentType = response.headers.get("content-type");
    const kind = classifyContentType(contentType);
    if (kind === void 0) {
      await response.body?.cancel();
      throw new WebError3(`unsupported content type "${contentType ?? "unknown"}"`, "WEB_UNSUPPORTED_CONTENT_TYPE");
    }
    let decoder;
    try {
      decoder = decoderForCharset(parseCharset(contentType));
    } catch (error) {
      await response.body?.cancel();
      throw error;
    }
    const { bytes, truncatedByBytes } = await this.readCapped(response, signal);
    const decoded = decoder.decode(bytes);
    const truncatedByChars = decoded.length > this.limits.maxBodyChars;
    const content = truncatedByChars ? decoded.slice(0, this.limits.maxBodyChars) : decoded;
    const body = kind === "html" ? { kind: "html", content } : { kind: "text", content };
    return {
      url: finalUrl.toString(),
      statusCode: response.status,
      body,
      truncated: truncatedByBytes || truncatedByChars
    };
  }
  /**
   * Read the response stream up to `maxResponseBytes`. A `Content-Length` over
   * the cap rejects immediately with `WEB_FETCH_TOO_LARGE`; a stream that grows
   * past the cap is cut short (`truncatedByBytes`) rather than rejected, so a
   * server that under-reports still yields a bounded usable body.
   */
  async readCapped(response, signal) {
    const declared = response.headers.get("content-length");
    if (declared !== null) {
      const length = Number(declared);
      if (Number.isFinite(length) && length > this.limits.maxResponseBytes) {
        await response.body?.cancel();
        throw new WebError3(`response exceeds the maximum of ${this.limits.maxResponseBytes} bytes`, "WEB_FETCH_TOO_LARGE");
      }
    }
    if (response.body === null) return { bytes: new Uint8Array(0), truncatedByBytes: false };
    const chunks = [];
    let total = 0;
    let truncatedByBytes = false;
    const reader = response.body.getReader();
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = this.limits.maxResponseBytes - total;
        if (value.byteLength > remaining) {
          chunks.push(value.subarray(0, remaining));
          total += remaining;
          truncatedByBytes = true;
          break;
        }
        chunks.push(value);
        total += value.byteLength;
      }
    } catch (error) {
      throw translateAbortOrNetwork(error, signal);
    } finally {
      await reader.cancel().catch(() => {
      });
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, truncatedByBytes };
  }
};
function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
function resolveRedirect(location, base) {
  try {
    return new URL(location, base);
  } catch (error) {
    throw new WebError3(`invalid redirect Location "${location}"`, "WEB_PROVIDER_ERROR", { cause: error });
  }
}
function translateAbortOrNetwork(error, signal) {
  const timeout = timeoutOf(signal, "WEB_FETCH_TIMEOUT");
  if (timeout !== void 0) return new WebError3("web fetch timed out", "WEB_FETCH_TIMEOUT", { cause: timeout });
  if (signal.aborted) return new WebError3("web fetch aborted", "WEB_ABORTED", { cause: error });
  return new WebError3(`web fetch failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
}

// web-fetch-http/src/index.ts
var MAX_NODE_TIMER_DELAY_MS = 2147483647;
var DEFAULT_USER_AGENT = "deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)";
var name = "web-fetch-fix";
var inject = ["web"];
var Config = z.object({
  maxResponseBytes: z.number().default(5e6),
  maxBodyChars: z.number().default(1e5),
  timeoutMs: z.number().default(3e4),
  maxRedirects: z.number().default(5),
  userAgent: z.string().default(DEFAULT_USER_AGENT)
});
function assertPositiveFinite(name2, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`web-fetch-http: ${name2} must be a positive finite number`);
  }
}
function assertTimeoutMs(value) {
  assertPositiveFinite("timeoutMs", value);
  if (value > MAX_NODE_TIMER_DELAY_MS) {
    throw new Error(`web-fetch-http: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`);
  }
}
function assertNonNegativeInteger(name2, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`web-fetch-http: ${name2} must be a non-negative integer`);
  }
}
function apply(ctx, config) {
  const resolved = config;
  assertPositiveFinite("maxResponseBytes", resolved.maxResponseBytes);
  assertPositiveFinite("maxBodyChars", resolved.maxBodyChars);
  assertTimeoutMs(resolved.timeoutMs);
  assertNonNegativeInteger("maxRedirects", resolved.maxRedirects);
  const limits = {
    maxResponseBytes: resolved.maxResponseBytes,
    maxBodyChars: resolved.maxBodyChars,
    timeoutMs: resolved.timeoutMs,
    maxRedirects: resolved.maxRedirects,
    userAgent: resolved.userAgent
  };
  ctx.web.registerFetchProvider(new HttpFetchProvider(limits));
}
export {
  Config,
  DEFAULT_USER_AGENT,
  HttpFetchProvider,
  LOCAL_FETCH_PROVIDER_ID,
  apply,
  inject,
  name
};
