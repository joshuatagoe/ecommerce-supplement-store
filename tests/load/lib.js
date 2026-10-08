// Shared by the k6 scripts (ARCHITECTURE.md §2 "Load tests"). They drive the
// app the way a browser does: provider steps are Next.js server actions,
// called by their build IDs, and the patient pays through the pay page's own
// form, posted the way it posts without JavaScript.
import http from "k6/http";

export const ctx = JSON.parse(open("./.run/context.json"));

/** Calls a server action as the browser does. Returns the response. */
export function action(path, name, arg, cookie, tag) {
  return http.post(`${ctx.base}${path}`, JSON.stringify([arg]), {
    headers: {
      "Next-Action": ctx.actions[name],
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
      // Browsers send Origin on every POST; Next checks it against the host for server actions.
      Origin: ctx.base,
      Cookie: cookie,
    },
    redirects: 0,
    tags: { name: tag },
  });
}

/** The ref in an action's redirect, such as /orders/K7Q2-M9XD;push. */
export function redirectedRef(response) {
  const match = /\/orders\/([A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4})/.exec(response.headers["X-Action-Redirect"] || "");
  return match ? match[1] : null;
}

const PAY_PATH = /\/pay\/[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}\.[A-Za-z0-9_-]{22}/;

/** The pay link's path from a page or an action's response, as the provider would copy it. */
export function payPath(text) {
  const match = PAY_PATH.exec(text || "");
  return match ? match[0] : null;
}

const ENTITIES = { "&quot;": '"', "&amp;": "&", "&#x27;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">" };

/** The pay form's hidden fields, as the browser would submit them. */
export function formFields(html) {
  const start = html.indexOf("<form");
  const form = html.slice(start, html.indexOf("</form>", start));
  const fields = {};
  const inputs = form.match(/<input[^>]*type="hidden"[^>]*>/g) || [];
  for (const tag of inputs) {
    const name = /name="([^"]+)"/.exec(tag);
    const value = /value="([^"]*)"/.exec(tag);
    if (name) fields[name[1]] = value ? value[1].replace(/&quot;|&amp;|&#x27;|&#39;|&lt;|&gt;/g, (e) => ENTITIES[e]) : "";
  }
  return fields;
}

/** Posts the pay form as multipart/form-data, the encoding React gives it. */
export function postPay(path, fields, card) {
  const boundary = `----k6${Math.random().toString(16).slice(2)}`;
  const all = Object.assign({}, fields, {
    cardNumber: card,
    expiry: "12/30",
    securityCode: "123",
    zip: "94110",
  });
  let body = "";
  for (const name of Object.keys(all)) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${all[name]}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return http.post(`${ctx.base}${path}`, body, {
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, Origin: ctx.base },
    redirects: 0,
    tags: { name: "pay" },
  });
}

export function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}
