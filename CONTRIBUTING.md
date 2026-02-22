# Contributing to SURI

Hey there! Thanks for considering helping out. This project started as my idea to "real world projects" but I'm hoping it grows into something bigger that can actually help people that can't afford fancy attendance systems.

## Getting Started

1. **Fork the repo** - Standard stuff, fork it to your account
2. **Clone locally** - `git clone https://github.com/YOUR-USERNAME/suri.git`
3. **Add upstream** - `git remote add upstream https://github.com/johnraivenolazo/suri.git`

## What kind of help I'm looking for

### Code stuff
- **Performance optimization** - The model runs okay on older hardware but could definitely be faster
- **Face recognition improvements** - Especially with different lighting conditions
- **Server-side code** - The Python backend needs some love
- **Frontend** - If you know your way around UI/UX, the interface could use an overhaul

### Non-code stuff
- **Documentation** - Always needed, especially step-by-step guides for non-technical teachers
- **Testing in different environments** - If you can try it on different hardware/OS combinations
- **Translation** - Making the interface accessible in more languages

## Development Process

Nothing fancy or bureaucratic here. I'm a student, not a big tech company.

1. **Create a branch** - `git checkout -b fix-something-cool`
2. **Make your changes** - Try to keep commits somewhat organized
3. **Test your stuff** - Make sure it actually works
4. **Push to your fork** - `git push origin fix-something-cool`
5. **Open a PR** - I'll try to review it ASAP

## Some guidelines to make life easier

- **Keep it simple** - This is meant to run in schools with limited IT resources
- **Document weird stuff** - If you're doing something non-obvious, leave comments
- **Think about performance** - Every millisecond counts on older hardware
- **Test on low-end devices** - If you can, test on something other than your beefy dev machine

## Model & Training

Details regarding the AI models and the development process can be found in the [Architecture Guide](docs/ARCHITECTURE.md).

## Local Development Setup

1. **Python 3.10+** - Recommended for compatibility with all dependencies
2. **Install requirements** - `pip install -r server/requirements.txt`
3. **ONNX Runtime** - Make sure this is installed for inference


## Questions?

Just open an issue or hit me up on **[LinkedIn](https://www.linkedin.com/in/johnraivenolazo/)**. I'm still learning too, so don't worry about asking "dumb" questions - there aren't any.

Thanks again for considering contributing! This project started in my dorm room with limited resources, but with your help, it can become something that actually makes a difference in society that need it.
