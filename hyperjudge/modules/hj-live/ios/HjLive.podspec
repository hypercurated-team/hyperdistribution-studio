Pod::Spec.new do |s|
  s.name           = 'HjLive'
  s.version        = '1.0.0'
  s.summary        = 'Lets the HyperJudge app drive rounds in the Live Activity'
  s.author         = 'HyperMixer'
  s.homepage       = 'https://hyperdistribution-studio.vercel.app'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,swift}'
end
