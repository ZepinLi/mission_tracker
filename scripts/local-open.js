#!/usr/bin/env node
const { execFile } = require("child_process");

const port = process.env.PORT || "4173";
const url = "http://127.0.0.1:" + port;

execFile("open", [url], (error) => {
  if (error) {
    console.log(url);
    return;
  }
  console.log("Opened " + url);
});
