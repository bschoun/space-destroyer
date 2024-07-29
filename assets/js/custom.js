/**
 * This will be loaded before starting the simulator.
 * If you wish to add custom javascript, 
 * ** make sure to add this line to pxt.json**
 * 
 *      "disableTargetTemplateFiles": true
 * 
 * otherwise MakeCode will override your changes.
 * 
 * To register a constrol simmessages, use addSimMessageHandler
 */

// Code to upload to Puck.js
var PUCK_CODE = `

// Don't want to use NFR's connect function since we'll already be connected when we upload the code.
/*NRF.on('connect', function() {})*/

Puck.accelOn(52);
digitalPulse(LED2, 1, 500);

/*const batteryIntervalId = setInterval(function(){
    reportBattery()
}, 60000)*/

// Turn off the accelerometer and battery reporting when we disconnect. Blink red LED.
NRF.on('disconnect', function() {
    Puck.accelOff();
    digitalPulse(LED1, 1, 500)
    //clearInterval(batteryIntervalId);
})

// Have Puck report battery every 30 seconds
/*function reportBattery(){
    var d = [
        "B",
        Math.round(Puck.getBatteryPercentage()*100)
    ];
    Bluetooth.println(d.join(","));
}

setInterval(function(){
    reportBattery()
}, 60000)*/

Puck.on('accel',function(a) {
    //console.log(a);
    var d = [
        "A",
        Math.round(a["acc"]["x"]*100),
        Math.round(a["acc"]["y"]*100),
        Math.round(a["acc"]["z"]*100),
        Math.round(a["gyro"]["x"]*100),
        Math.round(a["gyro"]["y"]*100),
        Math.round(a["gyro"]["z"]*100)
    ];
    Bluetooth.println(d.join(","));
})
`;

// Vector3 variables to hold data from accel/gyro/battery
//var accel = new THREE.Vector3( 0, 0, 0);
var accel = {
        x: 0,
        y: 0,
        z: 0,
    };
var gyro = {
        x: 0,
        y: 0,
        z: 0,
    };
//var linearAccel = new THREE.Vector3(0, 0, 0);
//var velocity = new THREE.Vector3(0, 0, 0);
//var battery = 100;

// Constants 
const accelScale = 8192;    // Accel data must be divided by 8192, per this: https://www.espruino.com/Reference#l_Puck_accel
const gyroScale = 134;      // Gyro data must be divided by 134, per this: https://www.espruino.com/Reference#l_Puck_accel
const hz = 52;              // Data rate of accel/gyro. Make sure this matches the call to Puck.accelOn() in PUCK_CODE
const deltaTime = 1/hz;     // Change in time
const pi = Math.PI;         // Pi!
//const battLevelSpan = document.getElementById('battLevelSpan'); // Our battery level element
const simframe = document.getElementById('simframe');
const joystick = 
        document.getElementsByClassName('joystick-handle');

// Attitude/heading reference system using Madgwick algorithm. beta can be adjusted lower for smoother movement
const madgwick = new AHRS({
    sampleInterval: hz,
    algorithm: 'Madgwick',
    beta: 0.4,
    doInitialisation: true
});

// When we click the connect button...
var connection;
document.getElementById("btnConnect").addEventListener("click", function() 
{
    // disconnect if connected already
    if (connection) {
        connection.close();
        connection = undefined;
    }
    // Connect
    Puck.connect(function(c) {
        if (!c) {
            alert("Couldn't connect!");
            return;
        }
        connection = c;
        // Handle the data we get back, and call 'onLine'
        // whenever we get a line
        var buf = "";
        connection.on("data", function(d) {
            buf += d;
            var l = buf.split("\n");
            buf = l.pop();
            l.forEach(onLine);
        });
        // First, reset the Puck
        connection.write("reset();\n", function() {
            // Wait for it to reset itself
            setTimeout(function() {
            // Now upload our code to it
            connection.write("\x03\x10if(1){"+PUCK_CODE+"}\n",
                function() { console.log("Ready..."); });
            }, 1500);
        });
    });
});

// When we get a line of data, check it and if it's
// from the accelerometer, update it
function onLine(line) 
{
    //console.log("RECEIVED:"+line);
    var d = line.split(",");

    // Battery data
    /*if (d.length==2 && d[0]=="B") 
    {
        battery = parseInt(d[1])/100;  
        battLevelSpan.innerText = battery + "%"
        //console.log("BATTERY");
        //console.log(battery);
    }*/

    // Accelerometer/gyroscope data
    if (d.length==7 && d[0]=="A") 
    {
        // Accelerometer reading, scaled by accelScale (per Puck.js v2.0 documentation)
        accel.x = (parseInt(d[1])/100)/accelScale;
        accel.y = (parseInt(d[2])/100)/accelScale;
        accel.z = (parseInt(d[3])/100)/accelScale;

        //console.log("ACCEL");
        //console.log(accel);

        // Gyroscope reading, scaled by gyroScale (per Puck.js v2.0 documentation)
        gyro.x = degrees_to_radians((parseInt(d[4])/100)/gyroScale);
        gyro.y = degrees_to_radians((parseInt(d[5])/100)/gyroScale);
        gyro.z = degrees_to_radians((parseInt(d[6])/100)/gyroScale);
        //console.log("GYRO");
        //console.log(gyro);

        // Update the Madgwick filter
        madgwick.update(gyro.x, gyro.y, gyro.z, accel.x, accel.y, accel.z, 0, 0, 0, deltaTime);

        // Get the rotation data
        var e = madgwick.getEulerAngles();

        //console.log("pitch:", radians_to_degrees(e.pitch), "roll:", radians_to_degrees(e.roll));

        if (radians_to_degrees(e.roll) < -45) {
            arrow_left();
        }
        else if (radians_to_degrees(e.roll) > 45) {
            arrow_right();
        }
        
        if (radians_to_degrees(e.pitch) < -45) {
            arrow_down();
        }
        else if (radians_to_degrees(e.pitch) > 45) {
            arrow_up();
        }
    }
}

// Converts degrees to radians
function degrees_to_radians(degrees)
{
    // Multiply degrees by pi divided by 180 to convert to radians.
    return degrees * (pi/180);
}

function radians_to_degrees(radians)
{
    // Multiply radians by 180/pi to convert to degrees.
    return radians * (180/pi);
}

function arrow_right() {
    console.log("RIGHT");
    let arrowRightEvent = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        keyCode: 39,
        which: 39
    });

    simframe.dispatchEvent(arrowRightEvent);
}

function arrow_left() {
    console.log("LEFT");
    let arrowLeftEvent = new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        keyCode: 37,
        which: 37
    });

    simframe.dispatchEvent(arrowLeftEvent);
    Podium.keydown(65);
}

function arrow_down() {
    console.log("DOWN");
    let arrowDownEvent = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        keyCode: 40,
        which: 40
    });

    document.dispatchEvent(arrowDownEvent);
    controller.down().raiseButtonDown();
}

function arrow_up() {
    console.log("UP");
    let arrowUpEvent = new KeyboardEvent("keydown", {
        key: "ArrowUp",
        keyCode: 38,
        which: 38
    });

    document.dispatchEvent(arrowUpEvent);
    controller.up().raiseButtonDown();
}