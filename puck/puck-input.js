// Constants 
const accelScale = 8192;    // Accel data must be divided by 8192, per this: https://www.espruino.com/Reference#l_Puck_accel
const gyroScale = 134;      // Gyro data must be divided by 134, per this: https://www.espruino.com/Reference#l_Puck_accel
const hz = 52;              // Data rate of accel/gyro
const deltaTime = 1/hz;     // Change in time

// Code to upload to Puck.js
var PUCK_CODE = `
// Turn the accelerometer on, pulse the green LED to show we've connected
Puck.accelOn(${hz});
digitalPulse(LED2, 1, 500);

// Turn off the accelerometer and battery reporting when we disconnect. Blink red LED.
NRF.on('disconnect', function() {
    Puck.accelOff();
    digitalPulse(LED1, 1, 500)
})

// When we get new accelerometer readings, send them via BLE
Puck.on('accel',function(a) {
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

// Holds accel/gyro readings
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
var angles = {
    heading: 0,
    pitch: 0,
    roll: 0,
};

// Get the simframe element
/*const simframe = document.getElementById('simframe');
var simframeUrl = undefined;*/

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
    var d = line.split(",");

    // Accelerometer/gyroscope data
    if (d.length==7 && d[0]=="A") 
    {
        // Accelerometer reading, scaled by accelScale (per Puck.js v2.0 documentation)
        accel.x = (parseInt(d[1])/100)/accelScale;
        accel.y = (parseInt(d[2])/100)/accelScale;
        accel.z = (parseInt(d[3])/100)/accelScale;

        // Gyroscope reading, scaled by gyroScale (per Puck.js v2.0 documentation)
        gyro.x = degrees_to_radians((parseInt(d[4])/100)/gyroScale);
        gyro.y = degrees_to_radians((parseInt(d[5])/100)/gyroScale);
        gyro.z = degrees_to_radians((parseInt(d[6])/100)/gyroScale);

        // Update the Madgwick filter
        madgwick.update(gyro.x, gyro.y, gyro.z, accel.x, accel.y, accel.z, 0, 0, 0, deltaTime);

        // Get the rotation data
        var e = madgwick.getEulerAngles();
        angles.roll = radians_to_degrees(e.roll);
        angles.pitch = radians_to_degrees(e.pitch);

        // Move left
        if (angles.roll < -10) {
            arrow_left();
        }
        // Move right
        else if (angles.roll > 10) {
            arrow_right();
        }
        // If moving, stop
        else {
            arrow_central_horizontal();
        }
        
        // Shoot if the pitch > 5 degrees
        if (angles.pitch > 5) {
            rapid_fire_button_a();
        }
        else {
            release_button_a();
        }
    }
}

// Converts degrees to radians
function degrees_to_radians(degrees)
{
    // Multiply degrees by pi divided by 180 to convert to radians.
    return degrees * (Math.PI/180);
}

function radians_to_degrees(radians)
{
    // Multiply radians by 180/pi to convert to degrees.
    return radians * (180/Math.PI);
}

// If not tilting left OR right, stop pressing the appropriate button
function arrow_central_horizontal() {
    set_button(LEFT_BUTTON, false);
    set_button(RIGHT_BUTTON, false);
}

/* Move right */
function arrow_right() {
    set_button(LEFT_BUTTON, false);
    set_button(RIGHT_BUTTON, true);
}

/* Move left */
function arrow_left() {
    set_button(RIGHT_BUTTON, false);
    set_button(LEFT_BUTTON, true);
}

function release_button_a() {
    set_button(A_BUTTON, false);
}

/* Rapid fire when tilted down */
function rapid_fire_button_a() {
    if (buttons.get(A_BUTTON) == false) {
        set_button(A_BUTTON, true);
    }
    // need to release in order to press again for rapid fire
    else {
        set_button(A_BUTTON, false);
    }
}
