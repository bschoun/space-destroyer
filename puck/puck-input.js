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

/*** AHRS ***/

//= ====================================================================================================
// Based on MadgwickAHRS.c
//= ====================================================================================================
//
// Implementation of Madgwick's IMU and AHRS algorithms.
// See: http://www.x-io.co.uk/node/8#open_source_ahrs_and_imu_algorithms
//
//= ====================================================================================================

/**
 * @typedef {Object} EulerAngles
 * @property {number} heading - The direction of the object.  Angle around Z-axis.
 * @property {number} pitch - The forward/backward attitude of the object.  Angle around Y-axis.
 * @property {number} roll - The sideways angle of the object.  Angle around X-axis.
 */

/* eslint-disable one-var-declaration-per-line */

'use strict';

/**
 * The Madgwick algorithm.  See: http://www.x-io.co.uk/open-source-imu-and-ahrs-algorithms/.
 *
 * @param {number} sampleInterval - The sample interval in milliseconds.
 * @param {Object} options - The options.
 */
function Madgwick(sampleInterval, options) {
    //---------------------------------------------------------------------------------------------------
    // Definitions

    options = options || {};
    const sampleFreq = 1000 / sampleInterval; // sample frequency in Hz
    let beta = options.beta || 0.4; // 2 * proportional gain - lower numbers are smoother, but take longer to get to correct attitude.
    let initalised = options.doInitialisation === true ? false : true;

    //---------------------------------------------------------------------------------------------------
    // Variable definitions
    let q0 = 1.0,
        q1 = 0.0,
        q2 = 0.0,
        q3 = 0.0; // quaternion of sensor frame relative to auxiliary frame
    let recipSampleFreq = 1.0 / sampleFreq;

    //= ===================================================================================================
    // Functions

    //---------------------------------------------------------------------------------------------------
    // IMU algorithm update
    /**
     * @param {number} gx - gryo x
     * @param {number} gy - gyro y
     * @param {number} gz - gyro z
     * @param {number} ax - accel x
     * @param {number} ay - accel y
     * @param {number} az - accel z
     */
    function madgwickAHRSUpdateIMU(gx, gy, gz, ax, ay, az) {
        let recipNorm;
        let s0, s1, s2, s3;
        let qDot1, qDot2, qDot3, qDot4;
        let v2q0, v2q1, v2q2, v2q3, v4q0, v4q1, v4q2, v8q1, v8q2, q0q0, q1q1, q2q2, q3q3;

        // Rate of change of quaternion from gyroscope
        qDot1 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz);
        qDot2 = 0.5 * (q0 * gx + q2 * gz - q3 * gy);
        qDot3 = 0.5 * (q0 * gy - q1 * gz + q3 * gx);
        qDot4 = 0.5 * (q0 * gz + q1 * gy - q2 * gx);

        // Compute feedback only if accelerometer measurement valid (avoids NaN in accelerometer normalisation)
        if (!(ax === 0.0 && ay === 0.0 && az === 0.0)) {
            // Normalise accelerometer measurement
            recipNorm = (ax * ax + ay * ay + az * az) ** -0.5;
            ax *= recipNorm;
            ay *= recipNorm;
            az *= recipNorm;

            // Auxiliary variables to avoid repeated arithmetic
            v2q0 = 2.0 * q0;
            v2q1 = 2.0 * q1;
            v2q2 = 2.0 * q2;
            v2q3 = 2.0 * q3;
            v4q0 = 4.0 * q0;
            v4q1 = 4.0 * q1;
            v4q2 = 4.0 * q2;
            v8q1 = 8.0 * q1;
            v8q2 = 8.0 * q2;
            q0q0 = q0 * q0;
            q1q1 = q1 * q1;
            q2q2 = q2 * q2;
            q3q3 = q3 * q3;

            // Gradient decent algorithm corrective step
            s0 = v4q0 * q2q2 + v2q2 * ax + v4q0 * q1q1 - v2q1 * ay;
            s1 = v4q1 * q3q3 - v2q3 * ax + 4.0 * q0q0 * q1 - v2q0 * ay - v4q1 + v8q1 * q1q1 + v8q1 * q2q2 + v4q1 * az;
            s2 = 4.0 * q0q0 * q2 + v2q0 * ax + v4q2 * q3q3 - v2q3 * ay - v4q2 + v8q2 * q1q1 + v8q2 * q2q2 + v4q2 * az;
            s3 = 4.0 * q1q1 * q3 - v2q1 * ax + 4.0 * q2q2 * q3 - v2q2 * ay;
            recipNorm = (s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3) ** -0.5; // normalise step magnitude
            s0 *= recipNorm;
            s1 *= recipNorm;
            s2 *= recipNorm;
            s3 *= recipNorm;

            // Apply feedback step
            qDot1 -= beta * s0;
            qDot2 -= beta * s1;
            qDot3 -= beta * s2;
            qDot4 -= beta * s3;
        }

        // Integrate rate of change of quaternion to yield quaternion
        q0 += qDot1 * recipSampleFreq;
        q1 += qDot2 * recipSampleFreq;
        q2 += qDot3 * recipSampleFreq;
        q3 += qDot4 * recipSampleFreq;

        // Normalise quaternion
        recipNorm = (q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3) ** -0.5;
        q0 *= recipNorm;
        q1 *= recipNorm;
        q2 *= recipNorm;
        q3 *= recipNorm;
    }

    function cross_product(ax, ay, az, bx, by, bz) {
        return {
            x: ay * bz - az * by,
            y: az * bx - ax * bz,
            z: ax * by - ay * bx,
        };
    }

    /**
     * @param {number} ax - accel x
     * @param {number} ay - accel y
     * @param {number} az - accel z
     * @param {number} mx - mag x
     * @param {number} my - mag y
     * @param {number} mz - mag z
     * @returns {EulerAngles} - The Euler angles, in radians.
     */
    function eulerAnglesFromImuRad(ax, ay, az, mx, my, mz) {
        const pitch = -Math.atan2(ax, Math.sqrt(ay * ay + az * az));

        const tmp1 = cross_product(ax, ay, az, 1.0, 0.0, 0.0);
        const tmp2 = cross_product(1.0, 0.0, 0.0, tmp1.x, tmp1.y, tmp1.z);
        const roll = Math.atan2(tmp2.y, tmp2.z);

        const cr = Math.cos(roll);
        const sp = Math.sin(pitch);
        const sr = Math.sin(roll);
        const yh = my * cr - mz * sr;
        const xh = mx * Math.cos(pitch) + my * sr * sp + mz * cr * sp;

        const heading = -Math.atan2(yh, xh);

        return {
            heading,
            pitch,
            roll,
        };
    }

    // Pinched from here: https://en.wikipedia.org/wiki/Conversion_between_quaternions_and_Euler_angles

    function toQuaternion(eulerAngles) {
        const cy = Math.cos(eulerAngles.heading * 0.5);
        const sy = Math.sin(eulerAngles.heading * 0.5);
        const cp = Math.cos(eulerAngles.pitch * 0.5);
        const sp = Math.sin(eulerAngles.pitch * 0.5);
        const cr = Math.cos(eulerAngles.roll * 0.5);
        const sr = Math.sin(eulerAngles.roll * 0.5);

        return {
            w: cr * cp * cy + sr * sp * sy,
            x: sr * cp * cy - cr * sp * sy,
            y: cr * sp * cy + sr * cp * sy,
            z: cr * cp * sy - sr * sp * cy,
        };
    }

    /**
     * Initalise the internal quaternion values.  This function only needs to be
     * called once at the beginning.  The attitude will be set by the accelometer
     * and the heading by the magnetometer.
     *
     * @param {number} ax - accel x
     * @param {number} ay - accel y
     * @param {number} az - accel z
     * @param {number} mx - mag x
     * @param {number} my - mag y
     * @param {number} mz - mag z
     */
    function init(ax, ay, az, mx, my, mz) {
        const ea = eulerAnglesFromImuRad(ax, ay, az, mx, my, mz);
        const iq = toQuaternion(ea);

        // Normalise quaternion
        const recipNorm = (iq.w * iq.w + iq.x * iq.x + iq.y * iq.y + iq.z * iq.z) ** -0.5;
        q0 = iq.w * recipNorm;
        q1 = iq.x * recipNorm;
        q2 = iq.y * recipNorm;
        q3 = iq.z * recipNorm;

        initalised = true;
    }

    //---------------------------------------------------------------------------------------------------
    // AHRS algorithm update

    /**
     * @param {number} gx - gryo x
     * @param {number} gy - gyro y
     * @param {number} gz - gyro z
     * @param {number} ax - accel x
     * @param {number} ay - accel y
     * @param {number} az - accel z
     * @param {number} mx - magetometer x
     * @param {number} my - magetometer y
     * @param {number} mz - magetometer z
     * @param {number} deltaTimeSec
     */
    function madgwickAHRSUpdate(gx, gy, gz, ax, ay, az, mx, my, mz, deltaTimeSec) {
        recipSampleFreq = deltaTimeSec || recipSampleFreq;

        if (!initalised) {
            init(ax, ay, az, mx, my, mz);
        }

        let recipNorm;
        let s0, s1, s2, s3;
        let qDot1, qDot2, qDot3, qDot4;
        let hx, hy;
        let v2q0mx, v2q0my, v2q0mz, v2q1mx, v2bx, v2bz, v4bx, v4bz, v2q0, v2q1, v2q2, v2q3, v2q0q2, v2q2q3;
        let q0q0, q0q1, q0q2, q0q3, q1q1, q1q2, q1q3, q2q2, q2q3, q3q3;

        // Use IMU algorithm if magnetometer measurement invalid (avoids NaN in magnetometer normalisation)
        if (mx === undefined || my === undefined || mz === undefined || (mx === 0 && my === 0 && mz === 0)) {
            madgwickAHRSUpdateIMU(gx, gy, gz, ax, ay, az);
            return;
        }

        // Rate of change of quaternion from gyroscope
        qDot1 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz);
        qDot2 = 0.5 * (q0 * gx + q2 * gz - q3 * gy);
        qDot3 = 0.5 * (q0 * gy - q1 * gz + q3 * gx);
        qDot4 = 0.5 * (q0 * gz + q1 * gy - q2 * gx);

        // Compute feedback only if accelerometer measurement valid (avoids NaN in accelerometer normalisation)
        if (!(ax === 0.0 && ay === 0.0 && az === 0.0)) {
            // Normalise accelerometer measurement
            recipNorm = (ax * ax + ay * ay + az * az) ** -0.5;
            ax *= recipNorm;
            ay *= recipNorm;
            az *= recipNorm;

            // Normalise magnetometer measurement
            recipNorm = (mx * mx + my * my + mz * mz) ** -0.5;
            mx *= recipNorm;
            my *= recipNorm;
            mz *= recipNorm;

            // Auxiliary variables to avoid repeated arithmetic
            v2q0mx = 2.0 * q0 * mx;
            v2q0my = 2.0 * q0 * my;
            v2q0mz = 2.0 * q0 * mz;
            v2q1mx = 2.0 * q1 * mx;
            v2q0 = 2.0 * q0;
            v2q1 = 2.0 * q1;
            v2q2 = 2.0 * q2;
            v2q3 = 2.0 * q3;
            v2q0q2 = 2.0 * q0 * q2;
            v2q2q3 = 2.0 * q2 * q3;
            q0q0 = q0 * q0;
            q0q1 = q0 * q1;
            q0q2 = q0 * q2;
            q0q3 = q0 * q3;
            q1q1 = q1 * q1;
            q1q2 = q1 * q2;
            q1q3 = q1 * q3;
            q2q2 = q2 * q2;
            q2q3 = q2 * q3;
            q3q3 = q3 * q3;

            // Reference direction of Earth's magnetic field
            hx = mx * q0q0 - v2q0my * q3 + v2q0mz * q2 + mx * q1q1 + v2q1 * my * q2 + v2q1 * mz * q3 - mx * q2q2 - mx * q3q3;
            hy = v2q0mx * q3 + my * q0q0 - v2q0mz * q1 + v2q1mx * q2 - my * q1q1 + my * q2q2 + v2q2 * mz * q3 - my * q3q3;
            v2bx = Math.sqrt(hx * hx + hy * hy);
            v2bz = -v2q0mx * q2 + v2q0my * q1 + mz * q0q0 + v2q1mx * q3 - mz * q1q1 + v2q2 * my * q3 - mz * q2q2 + mz * q3q3;
            v4bx = 2.0 * v2bx;
            v4bz = 2.0 * v2bz;

            // Gradient decent algorithm corrective step
            s0 =
                -v2q2 * (2.0 * q1q3 - v2q0q2 - ax) +
                v2q1 * (2.0 * q0q1 + v2q2q3 - ay) -
                v2bz * q2 * (v2bx * (0.5 - q2q2 - q3q3) + v2bz * (q1q3 - q0q2) - mx) +
                (-v2bx * q3 + v2bz * q1) * (v2bx * (q1q2 - q0q3) + v2bz * (q0q1 + q2q3) - my) +
                v2bx * q2 * (v2bx * (q0q2 + q1q3) + v2bz * (0.5 - q1q1 - q2q2) - mz);
            s1 =
                v2q3 * (2.0 * q1q3 - v2q0q2 - ax) +
                v2q0 * (2.0 * q0q1 + v2q2q3 - ay) -
                4.0 * q1 * (1 - 2.0 * q1q1 - 2.0 * q2q2 - az) +
                v2bz * q3 * (v2bx * (0.5 - q2q2 - q3q3) + v2bz * (q1q3 - q0q2) - mx) +
                (v2bx * q2 + v2bz * q0) * (v2bx * (q1q2 - q0q3) + v2bz * (q0q1 + q2q3) - my) +
                (v2bx * q3 - v4bz * q1) * (v2bx * (q0q2 + q1q3) + v2bz * (0.5 - q1q1 - q2q2) - mz);
            s2 =
                -v2q0 * (2.0 * q1q3 - v2q0q2 - ax) +
                v2q3 * (2.0 * q0q1 + v2q2q3 - ay) -
                4.0 * q2 * (1 - 2.0 * q1q1 - 2.0 * q2q2 - az) +
                (-v4bx * q2 - v2bz * q0) * (v2bx * (0.5 - q2q2 - q3q3) + v2bz * (q1q3 - q0q2) - mx) +
                (v2bx * q1 + v2bz * q3) * (v2bx * (q1q2 - q0q3) + v2bz * (q0q1 + q2q3) - my) +
                (v2bx * q0 - v4bz * q2) * (v2bx * (q0q2 + q1q3) + v2bz * (0.5 - q1q1 - q2q2) - mz);
            s3 =
                v2q1 * (2.0 * q1q3 - v2q0q2 - ax) +
                v2q2 * (2.0 * q0q1 + v2q2q3 - ay) +
                (-v4bx * q3 + v2bz * q1) * (v2bx * (0.5 - q2q2 - q3q3) + v2bz * (q1q3 - q0q2) - mx) +
                (-v2bx * q0 + v2bz * q2) * (v2bx * (q1q2 - q0q3) + v2bz * (q0q1 + q2q3) - my) +
                v2bx * q1 * (v2bx * (q0q2 + q1q3) + v2bz * (0.5 - q1q1 - q2q2) - mz);
            recipNorm = (s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3) ** -0.5; // normalise step magnitude
            s0 *= recipNorm;
            s1 *= recipNorm;
            s2 *= recipNorm;
            s3 *= recipNorm;

            // Apply feedback step
            qDot1 -= beta * s0;
            qDot2 -= beta * s1;
            qDot3 -= beta * s2;
            qDot4 -= beta * s3;
        }

        // Integrate rate of change of quaternion to yield quaternion
        q0 += qDot1 * recipSampleFreq;
        q1 += qDot2 * recipSampleFreq;
        q2 += qDot3 * recipSampleFreq;
        q3 += qDot4 * recipSampleFreq;

        // Normalise quaternion
        recipNorm = (q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3) ** -0.5;
        q0 *= recipNorm;
        q1 *= recipNorm;
        q2 *= recipNorm;
        q3 *= recipNorm;
    }

    return {
        update: madgwickAHRSUpdate,
        init,
        getQuaternion() {
            return {
                w: q0,
                x: q1,
                y: q2,
                z: q3,
            };
        },
    };
}

//= ====================================================================================================
// Based on MahonyAHRS.c
//= ====================================================================================================
//
// Madgwick's implementation of Mayhony's AHRS algorithm.
// See: http://www.x-io.co.uk/node/8#open_source_ahrs_and_imu_algorithms
//
//= ====================================================================================================

/* eslint-disable one-var-declaration-per-line */

'use strict';

/**
 * The Mahony algorithm.  See: http://www.x-io.co.uk/open-source-imu-and-ahrs-algorithms/.
 *
 * @param {number} sampleInterval - The sample interval in milliseconds.
 * @param {Object} options - The options.
 */
function Mahony(sampleInterval, options) {
    //---------------------------------------------------------------------------------------------------
    // Definitions

    options = options || {};
    const kp = options.kp || 1.0;
    const ki = options.ki || 0.0;

    const sampleFreq = 1000 / sampleInterval; // sample frequency in Hz
    let recipSampleFreq = 1 / sampleFreq;
    let initalised = options.doInitialisation === true ? false : true;

    //---------------------------------------------------------------------------------------------------
    // Variable definitions

    let twoKp = 2.0 * kp; // 2 * proportional gain (Kp)
    const twoKi = 2.0 * ki; // 2 * integral gain (Ki)
    let q0 = 1.0,
        q1 = 0.0,
        q2 = 0.0,
        q3 = 0.0; // quaternion of sensor frame relative to auxiliary frame
    let integralFBx = 0.0,
        integralFBy = 0.0,
        integralFBz = 0.0; // integral error terms scaled by Ki

    //= ===================================================================================================
    // Functions

    //---------------------------------------------------------------------------------------------------
    // IMU algorithm update
    //

    function mahonyAHRSUpdateIMU(gx, gy, gz, ax, ay, az) {
        let recipNorm;
        let halfvx, halfvy, halfvz;
        let halfex, halfey, halfez;

        // Compute feedback only if accelerometer measurement valid (NaN in accelerometer normalisation)
        if (ax !== 0 && ay !== 0 && az !== 0) {
            // Normalise accelerometer measurement
            recipNorm = (ax * ax + ay * ay + az * az) ** -0.5;
            ax *= recipNorm;
            ay *= recipNorm;
            az *= recipNorm;

            // Estimated direction of gravity and vector perpendicular to magnetic flux
            halfvx = q1 * q3 - q0 * q2;
            halfvy = q0 * q1 + q2 * q3;
            halfvz = q0 * q0 - 0.5 + q3 * q3;

            // Error is sum of cross product between estimated and measured direction of gravity
            halfex = ay * halfvz - az * halfvy;
            halfey = az * halfvx - ax * halfvz;
            halfez = ax * halfvy - ay * halfvx;

            // Compute and apply integral feedback if enabled
            if (twoKi > 0.0) {
                integralFBx += twoKi * halfex * recipSampleFreq; // integral error scaled by Ki
                integralFBy += twoKi * halfey * recipSampleFreq;
                integralFBz += twoKi * halfez * recipSampleFreq;
                gx += integralFBx; // apply integral feedback
                gy += integralFBy;
                gz += integralFBz;
            } else {
                integralFBx = 0.0; // prevent integral windup
                integralFBy = 0.0;
                integralFBz = 0.0;
            }
            // Apply proportional feedback
            gx += twoKp * halfex;
            gy += twoKp * halfey;
            gz += twoKp * halfez;
        }

        // Integrate rate of change of quaternion
        gx *= 0.5 * recipSampleFreq; // pre-multiply common factors
        gy *= 0.5 * recipSampleFreq;
        gz *= 0.5 * recipSampleFreq;
        const qa = q0;
        const qb = q1;
        const qc = q2;
        q0 += -qb * gx - qc * gy - q3 * gz;
        q1 += qa * gx + qc * gz - q3 * gy;
        q2 += qa * gy - qb * gz + q3 * gx;
        q3 += qa * gz + qb * gy - qc * gx;

        // Normalise quaternion
        recipNorm = (q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3) ** -0.5;
        q0 *= recipNorm;
        q1 *= recipNorm;
        q2 *= recipNorm;
        q3 *= recipNorm;
    }

    function cross_product(ax, ay, az, bx, by, bz) {
        return {
            x: ay * bz - az * by,
            y: az * bx - ax * bz,
            z: ax * by - ay * bx,
        };
    }

    /**
     * @param {number} ax - accel x
     * @param {number} ay - accel y
     * @param {number} az - accel z
     * @param {number} mx - mag x
     * @param {number} my - mag y
     * @param {number} mz - mag z
     * @returns {EulerAngles} - The Euler angles, in radians.
     */
    function eulerAnglesFromImuRad(ax, ay, az, mx, my, mz) {
        const pitch = -Math.atan2(ax, Math.sqrt(ay * ay + az * az));

        const tmp1 = cross_product(ax, ay, az, 1.0, 0.0, 0.0);
        const tmp2 = cross_product(1.0, 0.0, 0.0, tmp1.x, tmp1.y, tmp1.z);
        const roll = Math.atan2(tmp2.y, tmp2.z);

        const cr = Math.cos(roll);
        const sp = Math.sin(pitch);
        const sr = Math.sin(roll);
        const yh = my * cr - mz * sr;
        const xh = mx * Math.cos(pitch) + my * sr * sp + mz * cr * sp;

        const heading = -Math.atan2(yh, xh);

        return {
            heading,
            pitch,
            roll,
        };
    }

    // Pinched from here: https://en.wikipedia.org/wiki/Conversion_between_quaternions_and_Euler_angles

    function toQuaternion(eulerAngles) {
        const cy = Math.cos(eulerAngles.heading * 0.5);
        const sy = Math.sin(eulerAngles.heading * 0.5);
        const cp = Math.cos(eulerAngles.pitch * 0.5);
        const sp = Math.sin(eulerAngles.pitch * 0.5);
        const cr = Math.cos(eulerAngles.roll * 0.5);
        const sr = Math.sin(eulerAngles.roll * 0.5);

        return {
            w: cr * cp * cy + sr * sp * sy,
            x: sr * cp * cy - cr * sp * sy,
            y: cr * sp * cy + sr * cp * sy,
            z: cr * cp * sy - sr * sp * cy,
        };
    }

    /**
     * Initalise the internal quaternion values.  This function only needs to be
     * called once at the beginning.  The attitude will be set by the accelometer
     * and the heading by the magnetometer.
     *
     * @param {number} ax - accel x
     * @param {number} ay - accel y
     * @param {number} az - accel z
     * @param {number} mx - mag x
     * @param {number} my - mag y
     * @param {number} mz - mag z
     */
    function init(ax, ay, az, mx, my, mz) {
        const ea = eulerAnglesFromImuRad(ax, ay, az, mx, my, mz);
        const iq = toQuaternion(ea);

        // Normalise quaternion
        const recipNorm = (iq.w * iq.w + iq.x * iq.x + iq.y * iq.y + iq.z * iq.z) ** -0.5;
        q0 = iq.w * recipNorm;
        q1 = iq.x * recipNorm;
        q2 = iq.y * recipNorm;
        q3 = iq.z * recipNorm;

        initalised = true;
    }

    //
    //---------------------------------------------------------------------------------------------------
    // AHRS algorithm update
    //

    function mahonyAHRSUpdate(gx, gy, gz, ax, ay, az, mx, my, mz, deltaTimeSec) {
        recipSampleFreq = deltaTimeSec || recipSampleFreq;

        if (!initalised) {
            init(ax, ay, az, mx, my, mz);
        }

        let recipNorm;
        let q0q0, q0q1, q0q2, q0q3, q1q1, q1q2, q1q3, q2q2, q2q3, q3q3;
        let hx, hy, bx, bz;
        let halfvx, halfvy, halfvz, halfwx, halfwy, halfwz;
        let halfex, halfey, halfez;

        // Use IMU algorithm if magnetometer measurement invalid (avoids NaN in magnetometer normalisation)
        if (mx === undefined || my === undefined || mz === undefined || (mx === 0 && my === 0 && mz === 0)) {
            mahonyAHRSUpdateIMU(gx, gy, gz, ax, ay, az);
            return;
        }

        // Compute feedback only if accelerometer measurement valid (NaN in accelerometer normalisation)
        if (ax !== 0 && ay !== 0 && az !== 0) {
            // Normalise accelerometer measurement
            recipNorm = (ax * ax + ay * ay + az * az) ** -0.5;
            ax *= recipNorm;
            ay *= recipNorm;
            az *= recipNorm;

            // Normalise magnetometer measurement
            recipNorm = (mx * mx + my * my + mz * mz) ** -0.5;
            mx *= recipNorm;
            my *= recipNorm;
            mz *= recipNorm;

            // Auxiliary variables to repeated arithmetic
            q0q0 = q0 * q0;
            q0q1 = q0 * q1;
            q0q2 = q0 * q2;
            q0q3 = q0 * q3;
            q1q1 = q1 * q1;
            q1q2 = q1 * q2;
            q1q3 = q1 * q3;
            q2q2 = q2 * q2;
            q2q3 = q2 * q3;
            q3q3 = q3 * q3;

            // Reference direction of Earth's magnetic field
            hx = 2.0 * (mx * (0.5 - q2q2 - q3q3) + my * (q1q2 - q0q3) + mz * (q1q3 + q0q2));
            hy = 2.0 * (mx * (q1q2 + q0q3) + my * (0.5 - q1q1 - q3q3) + mz * (q2q3 - q0q1));
            bx = Math.sqrt(hx * hx + hy * hy);
            bz = 2.0 * (mx * (q1q3 - q0q2) + my * (q2q3 + q0q1) + mz * (0.5 - q1q1 - q2q2));

            // Estimated direction of gravity and magnetic field
            halfvx = q1q3 - q0q2;
            halfvy = q0q1 + q2q3;
            halfvz = q0q0 - 0.5 + q3q3;
            halfwx = bx * (0.5 - q2q2 - q3q3) + bz * (q1q3 - q0q2);
            halfwy = bx * (q1q2 - q0q3) + bz * (q0q1 + q2q3);
            halfwz = bx * (q0q2 + q1q3) + bz * (0.5 - q1q1 - q2q2);

            // Error is sum of cross product between estimated direction and measured direction of field vectors
            halfex = ay * halfvz - az * halfvy + (my * halfwz - mz * halfwy);
            halfey = az * halfvx - ax * halfvz + (mz * halfwx - mx * halfwz);
            halfez = ax * halfvy - ay * halfvx + (mx * halfwy - my * halfwx);

            // Compute and apply integral feedback if enabled
            if (twoKi > 0.0) {
                integralFBx += twoKi * halfex * recipSampleFreq; // integral error scaled by Ki
                integralFBy += twoKi * halfey * recipSampleFreq;
                integralFBz += twoKi * halfez * recipSampleFreq;
                gx += integralFBx; // apply integral feedback
                gy += integralFBy;
                gz += integralFBz;
            } else {
                integralFBx = 0.0; // prevent integral windup
                integralFBy = 0.0;
                integralFBz = 0.0;
            }

            // Apply proportional feedback
            gx += twoKp * halfex;
            gy += twoKp * halfey;
            gz += twoKp * halfez;
        }

        // Integrate rate of change of quaternion
        gx *= 0.5 * recipSampleFreq; // pre-multiply common factors
        gy *= 0.5 * recipSampleFreq;
        gz *= 0.5 * recipSampleFreq;
        const qa = q0;
        const qb = q1;
        const qc = q2;
        q0 += -qb * gx - qc * gy - q3 * gz;
        q1 += qa * gx + qc * gz - q3 * gy;
        q2 += qa * gy - qb * gz + q3 * gx;
        q3 += qa * gz + qb * gy - qc * gx;

        // Normalise quaternion
        recipNorm = (q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3) ** -0.5;
        q0 *= recipNorm;
        q1 *= recipNorm;
        q2 *= recipNorm;
        q3 *= recipNorm;
    }

    return {
        update: mahonyAHRSUpdate,
        init,
        getQuaternion() {
            return {
                w: q0,
                x: q1,
                y: q2,
                z: q3,
            };
        },
    };
}

/** *******************************************************************
 *                                                                   *
 *   Copyright 2016 Simon M. Werner                                  *
 *                                                                   *
 *   Licensed to the Apache Software Foundation (ASF) under one      *
 *   or more contributor license agreements.  See the NOTICE file    *
 *   distributed with this work for additional information           *
 *   regarding copyright ownership.  The ASF licenses this file      *
 *   to you under the Apache License, Version 2.0 (the               *
 *   "License"); you may not use this file except in compliance      *
 *   with the License.  You may obtain a copy of the License at      *
 *                                                                   *
 *      http://www.apache.org/licenses/LICENSE-2.0                   *
 *                                                                   *
 *   Unless required by applicable law or agreed to in writing,      *
 *   software distributed under the License is distributed on an     *
 *   "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY          *
 *   KIND, either express or implied.  See the License for the       *
 *   specific language governing permissions and limitations         *
 *   under the License.                                              *
 *                                                                   *
 ******************************************************************** */

'use strict';

const rad2deg = 180.0 / Math.PI;

function AHRS(options) {
  options = options || {};
  const sampleInterval = options.sampleInterval || 20;
  const algorithmName = options.algorithm || 'Madgwick';

  let Req;
  if (algorithmName === 'Mahony') {
    //Req = require('./Mahony');
      Req = Mahony;
  } else if (algorithmName === 'Madgwick') {
    //Req = require('./Madgwick');
      Req = Madgwick;
  } else {
    throw new Error(`AHRS(): Algorithm not valid: ${algorithmName}`);
  }
  const algorithmFn = Req(sampleInterval, options);

  // Copy all properties across
  const self = this;
  Object.keys(algorithmFn).forEach(prop => self[prop] = algorithmFn[prop]);
}

/**
 * Convert the quaternion to a vector with angle.  Reverse of the code
 * in the following link: http://www.euclideanspace.com/maths/geometry/rotations/conversions/angleToQuaternion/index.htm.
 *
 * @return {object} Normalised vector - {x, y, z, angle}.
 */
AHRS.prototype.toVector = function toVector() {
  const q = this.getQuaternion();
  const angle = 2 * Math.acos(q.w);
  const sinAngle = Math.sin(angle / 2);
  return {
    angle,
    x: q.x / sinAngle,
    y: q.y / sinAngle,
    z: q.z / sinAngle,
  };
};

/**
 * Return an object with the Euler angles {heading, pitch, roll}, in radians.
 *
 * Where:
 *   - heading is from magnetic north, going west (about z-axis).
 *   - pitch is from vertical, going forward (about y-axis).
 *   - roll is from vertical, going right (about x-axis).
 *
 * Thanks to:
 *   https://github.com/PenguPilot/PenguPilot/blob/master/autopilot/service/util/math/quat.c#L103.
 *
 * @return {object} {heading, pitch, roll} In radians.
 */
AHRS.prototype.getEulerAngles = function getEulerAngles() {
  const q = this.getQuaternion();
  const ww = q.w * q.w,
    xx = q.x * q.x,
    yy = q.y * q.y,
    zz = q.z * q.z;
  return {
    heading: Math.atan2(2 * (q.x * q.y + q.z * q.w), xx - yy - zz + ww),
    pitch: -Math.asin(2 * (q.x * q.z - q.y * q.w)),
    roll: Math.atan2(2 * (q.y * q.z + q.x * q.w), -xx - yy + zz + ww),
  };
};

/**
 * Return an object with the Euler angles {heading, pitch, roll}, in radians.
 *
 * Where:
 *   - heading is from magnetic north, going west (about z-axis).
 *   - pitch is from vertical, going forward (about y-axis).
 *   - roll is from vertical, going right (about x-axis).
 *
 * Thanks to:
 *   https://github.com/PenguPilot/PenguPilot/blob/master/autopilot/service/util/math/quat.c#L103.
 *
 * @returns {object} {heading, pitch, roll} In radians.
 */
AHRS.prototype.getEulerAnglesDegrees = function getEulerAnglesDegrees() {
  const getEulerAnglesRad = this.getEulerAngles();
  return {
    heading: getEulerAnglesRad.heading * rad2deg,
    pitch: getEulerAnglesRad.pitch * rad2deg,
    roll: getEulerAnglesRad.roll * rad2deg,
  };
};

