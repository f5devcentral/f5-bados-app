module.exports = function(grunt) {

  require('load-grunt-tasks')(grunt);

  grunt.loadNpmTasks('grunt-contrib-clean');
  //grunt.loadNpmTasks('grunt-regex-replace');

  grunt.initConfig({

    clean: {
      dist: "dist",
      tmp: "tmp",
    },

    copy: {
      src_to_dist: {
        cwd: 'src',
        expand: true,
        src: ['**/*', '!**/*.js'],
        dest: 'dist'
      },
      datasource: {
        cwd: 'src/admdb-grafana-datasource',
        expand: true,
        src: ['**/*', '!**/*.ts'],
        dest: 'dist/admdb-grafana-datasource'
      },
      panels: {
        cwd: 'src/panels',
        expand: true,
        src: ['**/*'],
        dest: 'dist/panels'
      },
      pluginDef: {
        expand: true,
        src: ['README.md'],
        dest: 'dist',
      },
      install: {
        src: ['**/*','!node_modules/**'],
        dest: 'C:\\Users\\kruman\\Desktop\\grafana-5.2.2\\data\\plugins\\f5-bados-app\\'
      }
    },

    

    watch: {
      rebuild_all: {
        files: ['src/**/*', 'README.md'],
        tasks: ['rebuild'],
        options: {spawn: false}
      },
    },

    babel: {
      options: {
        sourceMap: true,
        presets:  ["es2015"],
        plugins: ['transform-es2015-modules-systemjs'],
      },
      dist: {
        files: [{
          cwd: 'src',
          expand: true,
          src: ['**/*.js', '!**/panels/**', '!**/admdb-grafana-datasource/**'],
          dest: 'dist',
          ext:'.js'
        }]
      },
    }
  });

  grunt.registerTask('install', [
    'clean',
    'copy:src_to_dist',
    'copy:datasource',
    'copy:panels',
    'copy:pluginDef',
    'babel',
    'copy:install'
    ]);

  grunt.registerTask('default', [
    'clean',
    'copy:src_to_dist',
    'copy:datasource',
    'copy:panels',
    'copy:pluginDef',
    'babel',
    ]);

  grunt.registerTask('rebuild', [
    'clean:dist',
    'copy:src_to_dist',
    'copy:datasource',
    'copy:panels',
    'copy:pluginDef',
    'babel',
    ]);

  // does not have sass due to grafana file dependency
  grunt.registerTask('test', [
    'clean',
    'copy:src_to_dist',
    'copy:datasource',
    'copy:panels',
    'copy:pluginDef',
    'babel',
    ]);
};
