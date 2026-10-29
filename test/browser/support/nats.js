// The browser tier's NATS requester: one request over the embedded server's client listener, in
// the NATS text protocol on a plain socket, with no package between. The tier uses it to put an
// event of another type on the stream (a JetStream publish, whose reply is the stream's ack) and to
// read the stream's state (a JetStream API request), alongside what the page reads through the
// sdk's adapter. The root installs no NATS client for node: @nats-io/nats-core's own transport is
// the browser's WebSocket.

import { connect } from "node:net";

/** The inbox the one reply arrives on. */
const inbox = "_INBOX.browser";

/**
 * Sends one request to `subject` on the client listener at `port`, presenting `token`, with
 * `headers` (each a NATS header, sent in an HPUB) and `data` (a string), and resolves to the reply's
 * payload parsed as JSON; rejects on the server's -ERR, or after 5 s with no reply.
 */
export function request({ port, token, subject, headers = {}, data = "" }) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const done = (fn, value) => {
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };
    const timer = setTimeout(() => done(reject, new Error(`no reply to ${subject}`)), 5000);
    socket.on("error", (error) => done(reject, error));

    const block = Object.entries(headers)
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join("");
    const head = `NATS/1.0\r\n${block}\r\n`;
    const size = Buffer.byteLength(head) + Buffer.byteLength(data);
    const connectOptions = { verbose: false, auth_token: token, headers: true, protocol: 1 };
    socket.write(
      `CONNECT ${JSON.stringify(connectOptions)}\r\n` +
        `SUB ${inbox} 1\r\n` +
        `HPUB ${subject} ${inbox} ${Buffer.byteLength(head)} ${size}\r\n${head}${data}\r\n`,
    );

    // The reply is a MSG on the inbox (a JetStream reply carries no headers): its control line
    // gives the payload's size, and the payload follows it, ended by CRLF.
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const text = buffer.toString("latin1");
      const error = text.match(/(?:^|\r\n)-ERR ([^\r]*)\r\n/);
      if (error) return done(reject, new Error(`the NATS server refused: ${error[1]}`));
      const reply = text.match(new RegExp(`(?:^|\\r\\n)MSG ${inbox} 1 (\\d+)\\r\\n`));
      if (!reply) return;
      const start = reply.index + reply[0].length;
      const end = start + Number(reply[1]);
      if (buffer.length < end) return;
      done(resolve, JSON.parse(buffer.subarray(start, end).toString("utf8")));
    });
  });
}

/** The stream's state, its messages and first and last sequences, from the JetStream API. */
export async function streamState({ port, token, stream = "EMULATOR" }) {
  const info = await request({ port, token, subject: `$JS.API.STREAM.INFO.${stream}` });
  if (info.error) throw new Error(`stream ${stream}: ${info.error.description}`);
  return info.state;
}

/**
 * Publishes a CloudEvent in binary content mode, as go-messaging's broker does: its type the
 * subject, its attributes ce-* headers, and its JSON data the body; resolves to the stream's ack,
 * the stream and the sequence it stored the event at.
 */
export async function publishEvent({ port, token, type, id, source, subject, data }) {
  const ack = await request({
    port,
    token,
    subject: type,
    headers: {
      "ce-specversion": "1.0",
      "ce-id": id,
      "ce-source": source,
      "ce-type": type,
      "ce-subject": subject,
      "content-type": "application/json",
    },
    data: JSON.stringify(data),
  });
  if (ack.error) throw new Error(`publish ${type}: ${ack.error.description}`);
  return ack;
}
