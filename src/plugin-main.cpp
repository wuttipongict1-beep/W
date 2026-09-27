#include <obs-module.h>

#include <cstdint>
#include <string>

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("phoneobs", "en-US")

namespace {
struct PhoneCameraSource {
	obs_source_t *source = nullptr;
	obs_source_t *receiver = nullptr;
	uint32_t width = 1280;
	uint32_t height = 720;
};

const char *source_name(void *)
{
	return "Phone Camera";
}

void source_defaults(obs_data_t *settings)
{
	obs_data_set_default_int(settings, "slot", 1);
	obs_data_set_default_int(settings, "width", 1280);
	obs_data_set_default_int(settings, "height", 720);
	obs_data_set_default_string(settings, "server", "http://127.0.0.1:8888");
}

obs_properties_t *source_properties(void *)
{
	auto *properties = obs_properties_create();
	obs_properties_add_int(properties, "slot", "Phone slot", 1, 4, 1);
	obs_properties_add_int(properties, "width", "Canvas width", 160, 3840, 1);
	obs_properties_add_int(properties, "height", "Canvas height", 90, 2160, 1);
	obs_properties_add_text(properties, "server", "Local PhoneOBS server", OBS_TEXT_DEFAULT);
	return properties;
}

std::string receiver_url(const char *server, std::int64_t slot)
{
	std::string base(server);
	while (!base.empty() && base.back() == '/')
		base.pop_back();
	return base + "/view/" + std::to_string(slot);
}

void update_browser_source(PhoneCameraSource *source, obs_data_t *settings)
{
	source->width = static_cast<uint32_t>(obs_data_get_int(settings, "width"));
	source->height = static_cast<uint32_t>(obs_data_get_int(settings, "height"));
	auto *browser_settings = obs_data_create();
	const auto url = receiver_url(obs_data_get_string(settings, "server"), obs_data_get_int(settings, "slot"));
	obs_data_set_string(browser_settings, "url", url.c_str());
	obs_data_set_int(browser_settings, "width", source->width);
	obs_data_set_int(browser_settings, "height", source->height);
	obs_data_set_int(browser_settings, "fps", 30);
	obs_data_set_bool(browser_settings, "shutdown", false);
	obs_data_set_bool(browser_settings, "reroute_audio", false);
	if (source->receiver) {
		obs_source_update(source->receiver, browser_settings);
	} else {
		const std::string receiver_name = std::string("PhoneOBS Receiver - ") + obs_source_get_name(source->source);
		source->receiver = obs_source_create_private("browser_source", receiver_name.c_str(), browser_settings);
	}
	obs_data_release(browser_settings);

	if (!source->receiver)
		blog(LOG_ERROR, "PhoneOBS requires the OBS Browser Source plugin.");
}

void *source_create(obs_data_t *settings, obs_source_t *obs_source)
{
	auto *source = new PhoneCameraSource;
	source->source = obs_source;
	update_browser_source(source, settings);
	return source;
}

void source_update(void *data, obs_data_t *settings)
{
	update_browser_source(static_cast<PhoneCameraSource *>(data), settings);
}

void source_enum_active(void *data, obs_source_enum_proc_t callback, void *param)
{
	auto *source = static_cast<PhoneCameraSource *>(data);
	if (source->receiver)
		callback(source->source, source->receiver, param);
}

void source_destroy(void *data)
{
	auto *source = static_cast<PhoneCameraSource *>(data);
	if (source->receiver)
		obs_source_release(source->receiver);
	delete source;
}

uint32_t source_width(void *data)
{
	return static_cast<PhoneCameraSource *>(data)->width;
}

uint32_t source_height(void *data)
{
	return static_cast<PhoneCameraSource *>(data)->height;
}

void source_render(void *data, gs_effect_t *)
{
	auto *source = static_cast<PhoneCameraSource *>(data);
	if (source->receiver)
		obs_source_video_render(source->receiver);
}

obs_source_info phone_camera_info = {};
} // namespace

bool obs_module_load(void)
{
	phone_camera_info.id = "phoneobs_camera";
	phone_camera_info.type = OBS_SOURCE_TYPE_INPUT;
	phone_camera_info.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_CUSTOM_DRAW;
	phone_camera_info.get_name = source_name;
	phone_camera_info.create = source_create;
	phone_camera_info.destroy = source_destroy;
	phone_camera_info.update = source_update;
	phone_camera_info.get_defaults = source_defaults;
	phone_camera_info.get_properties = source_properties;
	phone_camera_info.enum_active_sources = source_enum_active;
	phone_camera_info.get_width = source_width;
	phone_camera_info.get_height = source_height;
	phone_camera_info.video_render = source_render;

	obs_register_source(&phone_camera_info);
	blog(LOG_INFO, "PhoneOBS loaded; video-only receiver source registered.");
	return true;
}
