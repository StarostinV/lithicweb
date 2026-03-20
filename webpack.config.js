const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
    const isProduction = argv.mode === 'production' || !argv.mode;

    return {
        entry: './src/main.js',
        output: {
            filename: 'bundle.js',
            path: path.resolve(__dirname, 'dist'),
            clean: true,
        },
        devServer: {
            static: [
                path.resolve(__dirname, 'dist'),
                { directory: path.resolve(__dirname), publicPath: '/' }
            ],
            port: 8000,
        },
        plugins: [
            new HtmlWebpackPlugin({
                template: './index.html',
                filename: 'index.html',
                scriptLoading: 'defer',
            }),
            new MiniCssExtractPlugin({
                filename: 'styles/[name].[contenthash].css',
            }),
            new CopyPlugin({
                patterns: [
                    { from: 'docs', to: 'docs' },
                    // Demo mesh: single source tests/fixtures, stable URL for dev + production
                    {
                        from: 'tests/fixtures/ply/test_annotated_mesh.ply',
                        to: 'demo/showcase.ply',
                    },
                ]
            }),
        ],
        module: {
            rules: [
                {
                    test: /\.js$/,
                    exclude: /node_modules/,
                    use: {
                        loader: 'babel-loader',
                        options: {
                            presets: ['@babel/preset-env']
                        }
                    }
                },
                {
                    test: /\.css$/,
                    use: [
                        isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
                        'css-loader',
                    ],
                },
            ]
        },
        optimization: isProduction ? {
            minimize: true,
        } : {},
        mode: isProduction ? 'production' : 'development'
    };
};
