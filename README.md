# F5 BIG-IP ASM DDOS Visualization application for grafana
## Installation
1. Install latest grafana (this tested with 5.2.4, should be fine with version 5.x.x)
2. Use the grafana-cli tool to install bados app and its dependencies from the commandline:
```
grafana-cli plugins install grafana-worldmap-panel 0.1.2
grafana-cli plugins install natel-discrete-panel 0.0.8-pre
grafana-cli --pluginUrl https://github.com/f5devcentral/f5-bados-app/archive/master.zip plugins install f5-bados-app
grafana-cli --pluginUrl https://github.com/akruman/grafana-diagram/archive/1.4.4.f5.zip plugins install f5-jdbranham-diagram-panel
grafana-cli --pluginUrl https://github.com/akruman/grafana-datatable-panel/archive/v0.0.6.f5.zip plugins install f5-briangann-datatable-panel

```
3. Restart your Grafana server.
4. Enable the just installed F5 bigip application
5. Configure data source per each BIG-IP
    - type: F5 Networks BIG-IP datasource
    - name: name your datasource
    - url: https://[ip]/ to your BIG-IP managment
    - access: sever
    - Basic Auth: V
    - Skip TLS Verification: V
    - user: bigip managment account user (can be guest)
    - password: 
    - database: default

6. for dev:
    sudo apt install npm
    npm install
    sudo apt install node-grunt-cli
    # do your changes, grunt to create dist
    grunt

