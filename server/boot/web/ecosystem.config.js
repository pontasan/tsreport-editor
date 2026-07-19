module.exports = {
    apps: [{
        name: "next",
        script: "/var/node/server.js",
        args: "",
        instances: "max",
        exec_mode: "cluster"
    }]
}