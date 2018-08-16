# F5 BIG-IP evergreen ASM DDOS Visualization application 
## Installation
1. Use the grafana-cli tool to install bados app and its dependencies from the commandline:
```
grafana-cli plugins install grafana-piechart-panel
grafana-cli plugins install grafana-worldmap-panel 0.1.2
grafana-cli --pluginUrl https://github.com/akruman/f5-bados-app/archive/evergreen.zip plugins install f5-bados-evergreen-app
grafana-cli --pluginUrl https://github.com/akruman/grafana-diagram/archive/1.4.4.f5.zip plugins install f5-jdbranham-diagram-panel
```
2. Restart your Grafana server.
3. Configure data source per each BIG-IP
    - type: F5 Networks BIG-IP datasource
    - name: name your datasource
    - url: https://<ip>/ to your BIG-IP managment
    - access: sever
    - Basic Auth: V
    - Skip TLS Verification: V
    - user: bigip managment account user (can be guest)
    - password: 
    - database: default