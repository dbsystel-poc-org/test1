var path = require('path');
var https = require('https');
var fs = require('fs');
var express = require("express");
var request = require('request');
var unirest = require('unirest');

var app = express();
var router = express.Router();
var ws = require('express-ws')(app);
var hpath = __dirname + '/views/';
var querystring = require('querystring');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
app.engine('.html', require('ejs').__express);
app.set('views', __dirname + '/views');
app.set('view engine', 'html');
app.use(express.static(path.join(__dirname, 'public')));

router.use(function(req, res, next) {
  next();
});

router.get("/", function(req, res) {
  res.sendFile(hpath + "index.html");
});

app.use("/", router);

app.use("*", function(req, res) {
  res.sendFile(hpath + "404.html");
});

var port = process.env.PORT || 9090;
app.listen(port, function() {
  console.log("DBSystel Portal running at port: " + port);
});

// IBM Cloud Schematics API Endpoint
var IBMCS_API_URL = "https://us-south.schematics.bluemix.net/v1/environments/";

// IBM Cloud Schematics API Key
var bxapikey = null;

// IBM Cloud Schematics Application environment data (JSON)
var envData = null;

//
// GET IBM Cloud IAM authroization token endpoints & access token
//
function getIBMAuthenticationToken(ws, bxapikey, cb) {
  ws.send("Identifying Authentication endpoint...");
  unirest.get('https://iam.bluemix.net/identity/.well-known/openid-configuration')
    .headers({
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    })
    .end(function(response) {
      if (!response.error) {
        ws.send("Authentication endpoint: " + response.body.token_endpoint)
        ws.send("Retrieving authentication token...");
        unirest.post(response.body.token_endpoint)
          .headers({
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic Yng6Yng='
          })
          .send("apikey=" + bxapikey)
          .send("grant_type=urn:ibm:params:oauth:grant-type:apikey")
          .send("response_type=cloud_iam,uaa")
          .send("uaa_client_id=cf")
          .send("uaa_client_secret=")
          .end(function(response) {
            if (!response.error) {
              access_token = response.body.access_token;
              cb(null, access_token);
            } else {
              ws.send("Error! Unable to get the authentication token: " + response.error.toString());
              ws.send("** Command ended in error **");
              cb(response.error, null);
            }
          });
      } else {
        ws.send("Error! Unable to contact the IBM UAA Authentication Server: " + response.error.toString());
        ws.send("** Command ended in error **");
        cb(response.error, null);
      }
    });
}

//
// List existing IBM Cloud Schematics environments
//
function listIBMCSEnvironments(ws, authToken, cb) {
  ws.send("Listing current environments...");
  unirest.get(IBMCS_API_URL)
    .headers({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + authToken
    })
    .end(function(response) {
      if (!response.error) {
        var envArray = response.body.resources;
        ws.send("Total environments: " + envArray.length);
        envArray.forEach(function(value) {
          ws.send('ENV id: ' + value.id + ' App name: ' + value.name + ' Env status: ' + value.status);
        });
        cb(null, envArray);
      } else {
        ws.send("Error! Failed to list the schematics environment: " + response.error.toString());
        cb(response.error, null);
      }
    });
}

//
// Create a new IBM Cloud Schematics environment
//
function createIBMCSEnvironment(ws, authToken, cb) {
  ws.send("Creating application environment...");
  unirest.post(IBMCS_API_URL)
    .headers({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + authToken
    })
    .send(envData)
    .end(function(response) {
      if (!response.error) {
        environment_id = response.body.id;
        ws.send('Application Environment ' + response.body.id + ' created. ' + 'App name: ' + response.body.name);
        cb(null, response.body.id);
      } else {
        ws.send("Error! Unable to create application environment: " + response.error.toString());
        ws.send("** Command ended in error **");
        cb(response.error, null);
      }
    });
}

//
// Run Plan to see if any errors before the resources are provisioned
//
function planIBMCSEnvironment(ws, authToken, envId, cb) {
  ws.send("Running a PLAN activity on the environment...");
  var plan_url = IBMCS_API_URL + envId + '/plan';
  unirest.post(plan_url)
    .headers({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + authToken
    })
    .send({})
    .end(function(response) {
      if (!response.error) {
        checkActivityStatus(ws, authToken, response.body.activityid, function(error, status, statusmessages) {
          if (!error) {
            cb(null, response.body.activityid);
          }
        });
      } else {
        ws.send("Error! PLAN environment activity failed: " + response.error.toString());
        ws.send("** Command ended in error **");
        cb(response.error, null);
      }
    });
}

//
// Run apply to provision the resources
//
function applyIBMCSEnvironment(ws, authToken, envId, cb) {
  ws.send("Running a APPLY activity on the environment...");
  var apply_url = IBMCS_API_URL + envId + '/apply';
  unirest.put(apply_url)
    .headers({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + authToken
    })
    .send({})
    .end(function(response) {
      if (!response.error) {
        checkActivityStatus(ws, authToken, response.body.activityid, function(error, status, statusmessages) {
          if (!error) {
            cb(null, response.body.activityid);
          }
        });
      } else {
        ws.send("Error! APPLY environment activity failed: " + response.error.toString());
        ws.send("** Command ended in error **");
        cb(response.error, null);
      }
    });
}

//
// Check the Activity log for Plan execution status
//
function checkActivityStatus(ws, authToken, activityId, cb) {
  var activity_url = IBMCS_API_URL + environment_id + '/activities/' + activityId;

  unirest.get(activity_url)
    .headers({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + authToken
    })
    .end(function(response) {
      if (!response.error) {
        if (response.body.status != "COMPLETED" &&
          response.body.status != "FAILED") {
          ws.send("Checking activity status..." + response.body.status);
          setTimeout(function() {
            checkActivityStatus(ws, authToken, activityId, cb);
          }, 10000);
        } else {
          ws.send("Activity " + response.body.status);
          cb(null, response.body.status, response.body.statusmessages);
        }
      } else {
        ws.send("Error! Activity status failed: " + response.error.toString());
        ws.send("** Command ended in error **");
        cb(response.error, null);
      }
    });
}

//
// Retrieve the logs
//
function getActivityLog(ws, authToken, activityId, cb) {
  var activity_log_url = IBMCS_API_URL + environment_id + '/activities/' + activityId + '/log';
  ws.send('Getting Logs...');
  unirest.get(activity_log_url)
    .headers({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + authToken
    })
    .end(function(response) {
      if (!response.error) {
        cb(null, response.body.toString());
      } else {
        ws.send("Error! Fetching activity Log failed: " + response.error.toString());
        ws.send("** Command ended in error **");
        cb(response.error.toString(), null);
      }
    });
}

//
// Create an environment
//
function createEnvironment(ws, appname, appdata) {
  envData = null;
  try {
    // Validate the input JSON data
    envData = JSON.parse(appdata);
  } catch (e) {
    ws.send("Error in parsing Application Environment data. Not a valid JSON.");
    ws.send(e.toLocaleString());
    ws.send("** Command ended in error **");
  }

  if (envData != null) {
    // Check if the IBM Cloud API keys are present
    var i, len = envData.variablestore.length;
    for (i = 0; i < len; i++) {
      if (envData.variablestore[i].name == "bxapikey" ||
        envData.variablestore[i].name == "ibm_cloud_apikey") {
        bxapikey = envData.variablestore[i].value;
        break;
      }
    }

    if (i < len) {
      getIBMAuthenticationToken(ws, bxapikey, function(error, authToken) {
        if (!error) {
          listIBMCSEnvironments(ws, authToken, function(error, envList) {
            if (!error) {
              createIBMCSEnvironment(ws, authToken, function(error, envId) {
                if (!error) {
                  planIBMCSEnvironment(ws, authToken, envId, function(error, activityId) {
                    if (!error) {
                      applyIBMCSEnvironment(ws, authToken, envId, function(error, activityId) {
                        if (!error) {
                          getActivityLog(ws, authToken, activityId, function(error, log) {
                            ws.send(log);
                            ws.send("** Command ended successfully **");
                          });
                        }
                      });
                    }
                  });
                }
              });
            }
          });
        }
      });
    } else {
      ws.send("Error! IBM Cloud API Key not provided or missing.")
      ws.send("** Command ended in error **");
    }
  }
}

// Web socket communication to the browser
router.ws('/data', function(ws, req) {
  ws.on('connection', function() {
    console.log('connection created');
  });
  ws.on('message', function(msg) {
    var params = JSON.parse(msg);
    if (params.type != 'init')
      console.log(params.type + ' request received for ' + params.appname);

    if (params.type == 'init') {
      console.log('client connected');
    } else if (params.type == 'create') {
      createEnvironment(ws, params.appname, params.appdata);
    } else {
      ws.send("Unsupported command: " + msg);
      ws.send("** Command ended in error **");
    }
  });
  ws.on('close', function() {
    console.log('connection closed');
  });
});

// End of program
