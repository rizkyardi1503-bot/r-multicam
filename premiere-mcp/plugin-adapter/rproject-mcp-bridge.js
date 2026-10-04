/*
  R Project Multicam AI <-> MCP localhost adapter.
  Include this script in the Premiere panel, then register handlers that call
  the plugin's EXISTING internal functions. It does not edit the timeline by itself.
*/
(function (global) {
  "use strict";

  var handlers = Object.create(null);
  var config = null;
  var timer = null;
  var running = false;
  var busy = false;

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function request(path, options) {
    if (!config) throw new Error("R Project MCP bridge is not configured.");
    var headers = Object.assign({
      "content-type": "application/json",
      "x-rproject-token": config.token
    }, (options && options.headers) || {});
    var res = await fetch(config.baseUrl + path, Object.assign({}, options || {}, { headers: headers }));
    if (res.status === 204) return null;
    var text = await res.text();
    var body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((body && body.error) || ("MCP bridge HTTP " + res.status));
    return body;
  }

  async function register() {
    return request("/v1/register", {
      method: "POST",
      body: JSON.stringify({
        pluginName: config.pluginName || "R Project Multicam AI",
        pluginVersion: config.pluginVersion || "unknown",
        hostName: config.hostName || "Adobe Premiere Pro",
        hostVersion: config.hostVersion || "unknown",
        platform: config.platform || navigator.platform || "unknown",
        capabilities: Object.keys(handlers)
      })
    });
  }

  async function sendResult(id, payload) {
    return request("/v1/commands/" + encodeURIComponent(id) + "/result", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function pollOnce() {
    if (!running || busy) return;
    busy = true;
    try {
      var command = await request("/v1/commands/next", { method: "GET" });
      if (!command) return;

      var handler = handlers[command.name];
      if (!handler) {
        await sendResult(command.id, {
          ok: false,
          error: "Unsupported plugin MCP command: " + command.name
        });
        return;
      }

      try {
        var result = await handler(command.args || {});
        await sendResult(command.id, { ok: true, result: result == null ? null : result });
      } catch (error) {
        await sendResult(command.id, {
          ok: false,
          error: error && error.message ? error.message : String(error)
        });
      }
    } catch (error) {
      // Keep polling. The MCP server may not be running yet.
    } finally {
      busy = false;
    }
  }

  async function loop() {
    while (running) {
      await pollOnce();
      await sleep(config.pollMs || 350);
    }
  }

  var api = {
    registerHandler: function (name, fn) {
      if (!name || typeof fn !== "function") throw new Error("Invalid MCP handler.");
      handlers[name] = fn;
    },

    removeHandler: function (name) {
      delete handlers[name];
    },

    updateState: async function (snapshot) {
      if (!config) return;
      try {
        await request("/v1/state", {
          method: "POST",
          body: JSON.stringify(snapshot || {})
        });
      } catch (error) {}
    },

    start: async function (options) {
      if (running) return;
      if (!options || !options.token) throw new Error("MCP token is required.");
      config = {
        baseUrl: options.baseUrl || "http://127.0.0.1:47821",
        token: options.token,
        pluginName: options.pluginName,
        pluginVersion: options.pluginVersion,
        hostName: options.hostName,
        hostVersion: options.hostVersion,
        platform: options.platform,
        pollMs: options.pollMs || 350
      };
      await register();
      running = true;
      loop();
    },

    stop: function () {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },

    isRunning: function () {
      return running;
    }
  };

  global.RProjectMCPBridge = api;
})(window);
