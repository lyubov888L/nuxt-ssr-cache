"use strict";

var path = require('path');

var _require = require('./serializer'),
    serialize = _require.serialize,
    deserialize = _require.deserialize;

var makeCache = require('./cache-builders');

var useragent = require('express-useragent');

function cleanIfNewVersion(cache, version) {
  if (!version) return;
  return cache.getAsync('appVersion').then(function (oldVersion) {
    if (oldVersion !== version) {
      console.log("Cache updated from ".concat(oldVersion, " to ").concat(version));
      return cache.resetAsync(); // unfortunately multi cache doesn't return a promise
      // and we can't await for it so as to store new version
      // immediately after reset.
    }
  });
}

function tryStoreVersion(cache, version) {
  if (!version || cache.versionSaved) return;
  return cache.setAsync('appVersion', version, {
    ttl: null
  }).then(function () {
    cache.versionSaved = true;
  });
}

module.exports = function cacheRenderer(nuxt, config) {
  // used as a nuxt module, only config is provided as argument
  // and nuxt instance will be provided as this context
  if (arguments.length < 2 && this.nuxt) {
    nuxt = this.nuxt;
    config = this.options;
  }

  if (!config.cache || !Array.isArray(config.cache.pages) || !config.cache.pages.length) {
    return;
  }

  var isDev = config.cache.isDev !== undefined ? config.cache.isDev : process.env.NODE_ENV === 'production';

  if (!isDev) {
    return;
  }

  function isCacheFriendly(path) {
    return config.cache.pages.some(function (pat) {
      return pat instanceof RegExp ? pat.test(path) : path.startsWith(pat);
    });
  }

  var currentVersion = config.version || config.cache.version;
  var cache = makeCache(config.cache.store);
  cleanIfNewVersion(cache, currentVersion);
  var renderer = nuxt.renderer;
  var renderRoute = renderer.renderRoute.bind(renderer);

  renderer.renderRoute = function (route, context) {
    var hostname = context.req.hostname || context.req.host || context.req.headers['host'];
    var userAgentString = context.req.headers['user-agent'];
    var isBot = useragent.parse(userAgentString).isBot;
    var cacheKey = config.cache.useHostPrefix === true && hostname ? path.join(hostname, route, '__', String(isBot)) : route; // hopefully cache reset is finished up to this point.

    tryStoreVersion(cache, currentVersion);

    if (!isCacheFriendly(route)) {
      return renderRoute(route, context);
    }

    function renderSetCache() {
      return renderRoute(route, context).then(function (result) {
        if (!result.error) {
          cache.setAsync(cacheKey, serialize(result));
        }

        return result;
      });
    }

    return cache.getAsync(cacheKey).then(function (cachedResult) {
      if (cachedResult) {
        return deserialize(cachedResult);
      }

      return renderSetCache();
    })["catch"](renderSetCache);
  };

  return cache;
};