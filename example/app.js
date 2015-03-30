/**
 *
 *  Demonstration for the unofficial_nest library
 *  logs in, reads status, constantly, for ever. :)
 *
 */

'use strict';
var util = require('util'),
    nest = require('../index.js');  // normally would be 'unofficial-nest-api'


function trimQuotes(s) {
    if (!s || s.length === 0) {
        return '';
    }
    var c = s.charAt(0);
    var start = (c === '\'' || c === '"') ? 1 : 0;
    var end = s.length;
    c = s.charAt(end - 1);
    end -= (c === '\'' || c === '"') ? 1 : 0;
    return s.substring(start, end);
}

if (process.argv.length < 4) {
    console.log('Usage: ' + process.argv[1] + ' USERNAME PASSWORD [OPTIONS]');
    console.log('');
    console.log('USERNAME and PASSWORD should be enclosed in quotes.');
    console.log('');

    process.exit(1); // failure to communicate with user app requirements. :)
}

var username = process.argv[2];
var password = process.argv[3];

if (username && password) {
    username = trimQuotes(username);
    password = trimQuotes(password);
    nest.login(username, password, function (err/*, status*/) {
        if (err) {
            console.log(err.message);
            process.exit(1);
            return;
        }
        console.log('Logged in');
        nest.fetchStatus(function (err, data) {
            for (var deviceId in data.device) {
                if (data.device.hasOwnProperty(deviceId)) {
                    var device = data.shared[deviceId];
                    console.log(util.format('%s [%s], Current temperature = %d°C target=%d°C',
                        device.name, deviceId,
                        device.current_temperature,
                        device.target_temperature));
                }
            }
            var ids = nest.getDeviceIds();
            console.log(ids[0 ]+': set target temp to 25.5C°');
            //nest.setTargetTemperatureType(ids[0], 'heat');
            nest.setTemperature(ids[0], 25.5, function(error, res) {
                if (error) {
                    console.log('ERROR: '+JSON.stringify(error));
                    return 2;
                }
                console.log('Reply: '+JSON.stringify(res));
            });
            //nest.setTemperature(26);
            //nest.setFanModeAuto();
            //subscribe();
            //nest.setAway();
            //nest.setHome();
        });
    });
}

function subscribeDone(deviceId, data, type) {
    // data if set, is also stored here: nest.lastStatus.shared[thermostatID]
    if (deviceId) {
        console.log('Device: ' + deviceId + ' type: ' + type);
        console.log(JSON.stringify(data));
    } else {
        console.log('No data');

    }
    setTimeout(subscribe, 2000);
}

function subscribe() {
    nest.subscribe(subscribeDone, ['shared', 'energy_latest']);
}
