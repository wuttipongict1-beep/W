cmake_minimum_required(VERSION 3.28)
project(phoneobs VERSION 0.1.0 LANGUAGES CXX)

find_package(libobs REQUIRED)

add_library(phoneobs MODULE src/plugin-main.cpp)
target_link_libraries(phoneobs PRIVATE OBS::libobs)
target_compile_features(phoneobs PRIVATE cxx_std_17)
set_target_properties(phoneobs PROPERTIES PREFIX "" OUTPUT_NAME "phoneobs")

if(WIN32)
  install(TARGETS phoneobs RUNTIME DESTINATION obs-plugins/64bit)
else()
  install(TARGETS phoneobs LIBRARY DESTINATION obs-plugins)
endif()
