import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CERTIFICATE_DATA_ROOT,
  DEFAULT_NGINX_RUNTIME_ROOT,
  certificateDataRoot,
  nginxRuntimeRoot,
} from "@/worker/lib/runtime/paths";

test("nginxRuntimeRoot falls back to default without env or override", () => {
  const previous = process.env.NGINX_RUNTIME_ROOT;
  delete process.env.NGINX_RUNTIME_ROOT;
  try {
    assert.equal(nginxRuntimeRoot(), DEFAULT_NGINX_RUNTIME_ROOT);
    assert.equal(nginxRuntimeRoot(null), DEFAULT_NGINX_RUNTIME_ROOT);
    assert.equal(nginxRuntimeRoot(""), DEFAULT_NGINX_RUNTIME_ROOT);
  } finally {
    if (previous === undefined) delete process.env.NGINX_RUNTIME_ROOT;
    else process.env.NGINX_RUNTIME_ROOT = previous;
  }
});

test("nginxRuntimeRoot prefers override over env", () => {
  const previous = process.env.NGINX_RUNTIME_ROOT;
  process.env.NGINX_RUNTIME_ROOT = "/env/nginx";
  try {
    assert.equal(nginxRuntimeRoot("/override/nginx"), "/override/nginx");
    assert.equal(nginxRuntimeRoot(), "/env/nginx");
  } finally {
    if (previous === undefined) delete process.env.NGINX_RUNTIME_ROOT;
    else process.env.NGINX_RUNTIME_ROOT = previous;
  }
});

test("certificateDataRoot falls back to default without env or override", () => {
  const previous = process.env.CERTIFICATE_DATA_ROOT;
  delete process.env.CERTIFICATE_DATA_ROOT;
  try {
    assert.equal(certificateDataRoot(), DEFAULT_CERTIFICATE_DATA_ROOT);
    assert.equal(certificateDataRoot(""), DEFAULT_CERTIFICATE_DATA_ROOT);
  } finally {
    if (previous === undefined) delete process.env.CERTIFICATE_DATA_ROOT;
    else process.env.CERTIFICATE_DATA_ROOT = previous;
  }
});

test("certificateDataRoot prefers override over env", () => {
  const previous = process.env.CERTIFICATE_DATA_ROOT;
  process.env.CERTIFICATE_DATA_ROOT = "/env/certs";
  try {
    assert.equal(certificateDataRoot("/override/certs"), "/override/certs");
    assert.equal(certificateDataRoot(), "/env/certs");
  } finally {
    if (previous === undefined) delete process.env.CERTIFICATE_DATA_ROOT;
    else process.env.CERTIFICATE_DATA_ROOT = previous;
  }
});
