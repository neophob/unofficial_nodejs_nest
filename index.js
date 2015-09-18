/*jshint camelcase: false */
/*jshint -W069 */
/*
 Copyright 2012 WiredPrairie.us

 Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 permit persons to whom the Software is furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all copies or substantial portions
 of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
 TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 DEALINGS IN THE SOFTWARE.

 FYI: Nest is a registered trademark of Nest Labs

 */
(function () {
    'use strict';

    var https = require('https'),
        queryString = require('querystring'),
        url = require('url');


    var nestSession = {};
    var defaultNestUserAgent = 'Nest/3.0.15 (iOS) os=6.0 platform=iPad3,1';

    var fanModes = {
        'auto'       : 'auto',
        'on'         : 'on',
        'off'        : 'off',
        'duty-cycle' : 'duty-cycle'
    };

    var temperatureTypes = {
      'cool'  : 'cool',
      'heat'  : 'heat',
      'range' : 'range',
      'off'   : 'off'
    };


    /* always call login first. :)  */
    /**
     * Login to the Nest thermostat.
     * @param {String} username Your Nest user name.
     * @param {String} password Your nest password.
     * @param {Function} done Callback to be called when login is complete.
     */
    var login = function (username, password, done) {
        nestPost({
          hostname: 'home.nest.com',
          port: 443,
          path:'/user/login',
          body: { 'username': username, 'password': password },
          done: function(data) {
              if (!data) {
                  if (typeof done === 'function') {
                    return done(new Error('parse error'), null);
                  }
              } else if (data.error) {
                  if (typeof done === 'function') {
                      done(new Error(data.error_description), null);
                  }
              } else {
                  nestSession = data;
                  nestExports.session = data;
                  nestSession.urls.transport_url = url.parse(nestSession.urls.transport_url);
                  if (!nestSession.urls.transport_url) {
                    return done(new Error('unable to parse transport_url in ' + JSON.stringify(nestSession.urls)));
                  }

                  fetchCurrentStatus(done);
/*                  if (typeof done === 'function') {
                      done(null, data);
                  }*/
              }
          }
      });
    };

    // Post data to Nest.
    // Settings object
    //   {
    //      hostname: string, usually set to the transport URL (default)
    //      port: defaults to 443, override here
    //      path : string
    //      body : string or object, if string, sent as is
    //              if object, converted to form-url encoded
    //              if body is string, content-type is auto set to
    //              application/json
    //              otherwise, set to urlencoded
    //              override this value with the headers param if
    //              needed
    //      headers: { headerName: Value }
    //      done: callback function
    //   }
    var nestPost = function (settings) {
        var allData = [];
        var post_data;
        var contentType;
        var hostname, port, path, body, headers, done, err;

        if (typeof settings === 'function') {
            // call the function and get the results, which
            // MUST be an object (so that it's processed below)
            settings = settings();
        }

        if (settings && typeof settings === 'object') {
            hostname = settings.hostname || nestSession.urls.transport_url.hostname;
            port = settings.port || nestSession.urls.transport_url.port;
            path = settings.path;
            body = settings.body || null;
            headers = settings.headers;
            done = settings.done;
            err = settings.error;
        } else {
            throw new Error('Settings I need to function properly!');
        }

        // convert to a form url encoded body
        if (typeof body !== 'string') {
            post_data = queryString.stringify(body);
            contentType = 'application/x-www-form-urlencoded; charset=utf-8';
        } else {
            post_data = body;
            contentType = 'application/json';
        }
        var options = {
            host:hostname,
            port:port,
            path:path,
            method:'POST',
            headers:{
                'Content-Type':contentType,
                'User-Agent':nestExports.userAgent,
                'Content-Length':post_data.length
            }
        };

        if (headers) {
            options.headers = merge(options.headers, headers);
        }

        // if we're already authorized, add the necessary stuff....
        if (nestSession && nestSession.access_token) {
            options.headers = merge(options.headers, {
                'X-nl-user-id':nestSession.userid,
                'X-nl-protocol-version':'1',
                'Accept-Language':'en-us',
                'Authorization':'Basic ' + nestSession.access_token
            });
        }

        var request = https.request(options,
            function (response) {
                response.setEncoding('utf8');
                if (response.statusCode > 399) {
                    nestExports.logger.error('nestPost', 'Invalid Response Status Code: '+response.statusCode);
                    if (err) {
                        err(null, new Error('Response Status Code: '+response.statusCode));
                    }
                }
                response.on('data', function (data) {
                    allData.push(data);
                });
                response.on('end', function () {
                    // convert all data
                    allData = allData.join('');
                    if (allData && typeof allData === 'string' && allData.length > 0) {
                        try { allData = JSON.parse(allData); } catch(ex) {
                            nestExports.logger.error('nestPost invalid reply: '+JSON.stringify(allData), { exception: ex });
                            allData = null;
                        }
                    } else {
                        allData = null;
                    }
                    if (done) {
                        done(allData, response.headers || {});
                    }
                });
            }).on('error', function (err) {
               nestExports.logger.error('nestPost', { exception: err });
                if (typeof err === 'function') {
                    err(null, new Error(err.message));
                }
               if (done) {
                    done(null, {});
               }
            });
        request.write(post_data);
        request.end();
    };

    var nestGet = function (path, done) {
        var allData = [];

        if ((!nestSession) || (!nestSession.urls) || (!nestSession.urls.transport_url)) {
          return setTimeout(function() {
               nestExports.logger.error('get', { exception: new Error('invalid session information') });
                if (!!done) {
                    done(null);
                }
          }, 0);
        }
        var options = {
            host:nestSession.urls.transport_url.hostname,
            port:nestSession.urls.transport_url.port,
            path:path,
            method:'GET',
            headers:{
                'User-Agent':nestExports.userAgent,
                'X-nl-user-id':nestSession.userid,
                'X-nl-protocol-version':'1',
                'Accept-Language':'en-us',
                'Authorization':'Basic ' + nestSession.access_token
            }
        };
        var request = https.request(options,
            function (response) {

                response.setEncoding('utf8');
                response.on('data', function (data) {
                    allData.push(data);
                });
                response.on('end', function () {
                    // convert all data
                    allData = allData.join('');

                    if (allData && typeof allData === 'string' && allData.length > 0) {
                        try { allData = JSON.parse(allData); } catch(ex) {
                            nestExports.logger.error('get', { exception: ex });
                            allData = null;
                        }
                    } else {
                        allData = null;
                    }
                    if (done) {
                        done(allData);
                    }

                });
            }).on('error', function (err) {
               nestExports.logger.error('get', { exception: err });
                if (done) {
                    done(null);
                }
            }).end();
    };

    var fetchCurrentStatus = function (done) {
        nestGet('/v2/mobile/' + nestSession.user, function (data) {
            if (!data) {
                if (done) {
                    done(new Error('fetchCurrentStatus failed: no data'));
                }
                return;
            }

            nestExports.lastStatus = data;

            if (done) {
                done(null, data);
            }


        });
    };

    function pushKeys(keys, node, idNode) {
        idNode = idNode || node;         // might be the same thing ...

        var lastStatus = nestExports.lastStatus;
        var src;
        var version = 0;
        var timestamp = 0;
        // loop through a master list (that always has all keys)
        // but we might find data stored more specifically for a single key
        for (var id in lastStatus[idNode]) {
            src = version = timestamp = 0;
            if (lastStatus[node] && lastStatus[node].hasOwnProperty(id)) {
                src = node;
                version = lastStatus[node][id]['$version'];
                timestamp = lastStatus[src][id]['$timestamp'] || toUtc().getTime();
            } else if (lastStatus[idNode] && lastStatus[idNode].hasOwnProperty(id)) {
                src = idNode;
            }
            if (src) {
                keys.push({
                    key:node + '.' + id,
                    version:parseInt(version, 10), // subtle -- this MUST be a number, and not a quoted string with a number
                    timestamp:parseInt(timestamp, 10) // ditto
                });
            }
        }
    }

    // returns current date/time as UTC (or UTC of passed value)
    // to convert to a nest friendly time, use .getTime() on the return
    // value.
    function toUtc(now) {
        now = now || new Date();
        var now_utc = new Date(now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            now.getUTCHours(),
            now.getUTCMinutes(),
            now.getUTCSeconds(),
            now.getUTCMilliseconds()
        );
        return now_utc;
    }

    var subscribe = function (done, types) {
        // always have something ...
        types = types || ['shared'];
        var body = {};
        // the only thing sent are the keys in a subscription
        var keys = body.keys = [];
        // here's what we did last time
        var lastStatus = nestExports.lastStatus;

        for (var i = 0, l = types.length; i < l; i++) {
            var key = types[i];
            switch (key) {
                case 'user':
                case 'shared':
                case 'track':
                case 'device':
                case 'structure':
                case 'user_alert_dialog':
                case 'user_settings':
                    pushKeys(keys, key);
                    break;
                case 'energy_latest':
                    pushKeys(keys, key, 'device');
                    break;
                default:
                    throw new Error('Unknown subscription type: ' + key);
            }
        }

        keys.sort(function (a, b) {
            var d1 = a.key.split('.');
            var d2 = b.key.split('.');
            if (d1[1] < d2[1]) {
                return -1;
            }
            if (d1[1] > d2[1]) {
                return 1;
            }
            if (d1[0].substr(0, 6) === 'energy') {
                return 1;
            }
            return 0;
        });

        nestPost({
                path:'/v2/subscribe',
                body:JSON.stringify(body),
                headers:{
                    'X-nl-subscribe-timeout':60
                },
                done:function (data, headers) {
                    if (!data || !headers) {
                        // nothing to do apparently ....
                        done();
                        return;
                    }
                    var device = headers['x-nl-skv-key'];
                    var timestamp = headers['x-nl-skv-timestamp'] || toUtc().getTime();
                    var version = headers['x-nl-skv-version'];

                    if (typeof device === 'string' && device.length > 0) {
                        device = device.split('.');
                        if (device.length > 1) {
                            // throw the version and timestamp on in a standard location for next time!
                            data['$version'] = version;
                            data['$timestamp'] = timestamp;
                            lastStatus[device[0]] = lastStatus[device[0]] || {};
                            lastStatus[device[0]][device[1]] = data;
                            if (done) {
                                done(device[1], data, device[0]);
                                return;
                            }
                        }
                    }
                    done();

                },
                error: function(res, error) {
                    nestExports.logger.debug('subscribe failed: '+error.message);
                 }
            }
         );

     };
    // if first parameter is not a deviceId, treats
    // it like a temperature, and sets the temperature
    // using that value (and then uses the first thermostat
    // found in your structure
    //      setTemperature(temp)
    //          equiv to setTemperature(getFirstDeviceId(), temp)
    var setTemperature = function (deviceId, tempC, cb) {
        if (typeof tempC === 'undefined') {
            tempC = deviceId;
            deviceId = null;
        }

        if (!deviceId) {
            deviceId = getFirstDeviceId();
        }

        // likely passed in a F temp, so just convert it.
        if (tempC > 45) {
            tempC = fahrenheitToCelsius(tempC);
        }
        
        if (!isDeviceId(deviceId)) {
            if (cb) {
                cb(new Error('Invalid deviceId: '+deviceId));
            }
            return;
        }

        function isNumber(o) {
            return typeof o === 'number' && isFinite(o);
        }
        var tempAsNumeric = tempC;
        if (!isNumber(tempC)) {
            tempAsNumeric = parseFloat(tempC);
        }
        var body = {
            'target_temperature':tempAsNumeric
        };

        var headers = {
            'X-nl-base-version':nestExports.lastStatus['shared'][deviceId]['$version'],
            'Content-Type':'application/json'
        };

        nestPost({
            path:'/v2/put/shared.' + deviceId,
            body:JSON.stringify(body),
            headers:headers,
            done:function (data) {
                if (cb) {
                    cb(null, data);
                }
            },
            error: function(res, error) {
                if (cb) {
                    cb(error);
                }
            }
        });
    };


    var setAway = function (away, structureId, cb) {
        structureId = structureId || getFirstStructureId();
        if (!structureId) {
            if (cb) {
                cb(new Error('Missing required structureId'));
            }
            return;
        }

        if (!isStructureId(structureId)) {
            if (cb) {
                cb(new Error('Invalid structureId: '+structureId));
            }
            return;
        }

        away = typeof away === 'undefined' ? true : away; // default to Away

        var body = {
            'away_timestamp':toUtc().getTime(),
            'away':away,
            'away_setter':0
        };

        body = JSON.stringify(body);
        var headers = {
            'X-nl-base-version':nestExports.lastStatus['structure'][structureId]['$version'],
            'Content-Type':'application/json'
        };

        nestPost({
            path:'/v2/put/structure.' + structureId,
            body:body,
            headers:headers,
            done:function () {
                if (cb) {
                    cb(null, away);
                }
            },
            error: function(res, error) {
                if (cb) {
                    cb(error);
                }
            }
        });
    };

    var setHome = function (structureId, cb) {
        setAway(false, structureId, cb);
    };

    var setFanMode = function (deviceId, fanMode, time, cb) {
        deviceId = deviceId || getFirstDeviceId();
        if (!deviceId) {
            if (cb) {
                cb(new Error('Missing required deviceId'));
            }
            return;
        }

        if (!isDeviceId(deviceId)) {
            if (cb) {
                cb(new Error('Invalid deviceId: '+deviceId));
            }
            return;
        }

        if (!(fanMode in fanModes)) {
            if (cb) {
                cb(new Error('Invalid fanMode: ' + fanMode));
            }
            return;
        }

        var body = {
            'fan_mode': fanMode
        };

        if (((fanMode === 'on') && (!!time)) || (fanMode === 'duty-cycle')) {
            if (fanMode === 'on') {
                delete(body.fan_mode);
            }
            body.fan_timer_duration = Math.round(time / 1000);
            body.fan_timer_timeout = Math.round((Date.now() + time) / 1000);
        }


        var postData = {
            path:'/v2/put/device.' + deviceId,
            body:JSON.stringify(body),
            done:function (data) {
                nestExports.logger.debug('Set fan mode to ' + fanMode);
                if (cb) {
                    cb(null, data);
                }
            },
            error: function(res, error) {
                if (cb) {
                    cb(error);
                }
            }
        };

        nestPost(postData);
    };

    var setFanModeOn = function (deviceId, cb) {
        setFanMode(deviceId, fanModes.on, cb);
    };

    var setFanModeAuto = function (deviceId, cb) {
        setFanMode(deviceId, fanModes.auto, cb);
    };

    var setTargetTemperatureType = function(deviceId, tempType, cb) {
        deviceId = deviceId || getFirstDeviceId();
        if (!deviceId) {
            if (cb) {
                cb(new Error('Missing required deviceId'));
            }
            return;
        }

        if (!isDeviceId(deviceId)) {
            if (cb) {
                cb(new Error('Invalid deviceId: '+deviceId));
            }
            return;
        }

        if (!(tempType in temperatureTypes)) {
            if (cb) {
                cb(new Error('Invalid temperature type: ' + tempType));
            }
            return;
        }

        var body = JSON.stringify({
            'target_temperature_type': tempType,
            'target_change_pending' : true
        });

        var headers = {
            'X-nl-base-version':nestExports.lastStatus['shared'][deviceId]['$version'],
            'Content-Type':'application/json'
        };

        var postData = {
            path:'/v2/put/shared.' + deviceId,
            headers: headers,
            body: body,
            done: function(data) {
                if (cb) {
                    cb(null, data);
                }

            },
            error: function(res, error) {
                if (cb) {
                    cb(error);
                }
            }

        };

        nestPost(postData);
    };

    var fahrenheitToCelsius = function (f) {
        return (f - 32) * 5 / 9.0;
    };

    var celsiusToFahrenheit = function (c) {
        return Math.round(c * (9 / 5.0) + 32.0);
    };

    function merge(o1, o2) {
        o1 = o1 || {};
        if (!o2) {
            return o1;
        }
        for (var p in o2) {
            o1[p] = o2[p];
        }
        return o1;
    }

    // this just gets the first structure id, nothing fancy
    var getFirstStructureId = function () {
        var allIds = getStructureIds();
        if (!allIds || allIds.length === 0) {
            return null;
        }
        return allIds[0];
    };

    var getStructureIds = function () {
        var structures = nestExports.lastStatus.structure;
        var allIds = [];
        for (var id in structures) {
            if (structures.hasOwnProperty(id)) {
                allIds.push(id);
            }
        }
        return allIds;
    };

    function isStructureId(structureId) {
        return getStructureIds().indexOf(structureId) > -1;
    }

    var getFirstDeviceId = function () {
        var allIds = getDeviceIds();
        if (!allIds || allIds.length === 0) {
            return null;
        }
        return allIds[0];
    };

    var getDeviceIds = function () {
        var devices = nestExports.lastStatus.device;
        var allIds = [];
        for (var id in devices) {
            if (devices.hasOwnProperty(id)) {
                allIds.push(id);
            }
        }
        return allIds;
    };

    function isDeviceId(deviceId) {
        return getDeviceIds().indexOf(deviceId) > -1;
    }

    // exported function list
    var nestExports = {
        'login':login,
        'setTemperature':setTemperature,
        'setAway':setAway,
        'setHome':setHome,
        'setFanMode':setFanMode,
        'setFanModeOn':setFanModeOn,
        'setFanModeAuto':setFanModeAuto,
        'setTargetTemperatureType':setTargetTemperatureType,
        'fetchStatus':fetchCurrentStatus,
        'subscribe':subscribe,
        'get':nestGet,
        'post':nestPost,
        'ftoc':fahrenheitToCelsius,
        'ctof':celsiusToFahrenheit,
        'getStructureId':getFirstStructureId,
        'getStructureIds':getStructureIds,
        'getDeviceIds':getDeviceIds,
        'logger': { error   : function(msg, props) { console.log(msg); if (!!props) console.log(props); },
                    warning : function(msg, props) { console.log(msg); if (!!props) console.log(props); },
                    notice  : function(msg, props) { console.log(msg); if (!!props) console.log(props); },
                    info    : function(msg, props) { console.log(msg); if (!!props) console.log(props); },
                    debug   : function(msg, props) { console.log(msg); if (!!props) console.log(props); }
                  }
    };

    nestExports.userAgent = defaultNestUserAgent;

    var root = this; // might be window ...
    if (typeof exports !== 'undefined') {
        if (typeof module !== 'undefined' && module.exports) {
            exports = module.exports = nestExports;
        }
        exports.nest = nestExports;
    } else {
        root.nest = nestExports;
    }

})();
