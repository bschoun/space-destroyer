// Add the "Connect Puck.js" link/button to the footer
var footer = document.getElementById("footer");
footer.innerHTML = "<button id=\"btnConnect\">Connect Puck.js</button>" + footer.innerHTML;

var script1 = document.createElement('script');
script1.type = 'text/javascript';
script1.src = 'https://www.puck-js.com/puck.js';
document.body.appendChild(script1);

var script2 = document.createElement('script');
script2.type = 'text/javascript';
script2.src = 'puck/www-ahrs.js';
document.body.appendChild(script2);

var script3 = document.createElement('script');
script3.type = 'text/javascript';
script3.src = 'puck/arcade-input.js';
document.body.appendChild(script3);

var script4 = document.createElement('script');
script4.type = 'text/javascript';
script4.src = 'puck/puck-input.js';
document.body.appendChild(script4);

