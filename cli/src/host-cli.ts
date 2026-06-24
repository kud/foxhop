import { runHost } from "./host.js"
import { install } from "./install.js"

const command = process.argv[2]

if (command === "install") install()
else runHost()
